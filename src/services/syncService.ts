import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { Task, SyncQueueItem, SyncResult, BatchSyncRequest, BatchSyncResponse } from '../types';
import { Database } from '../db/database';
import { TaskService } from './taskService';

export class SyncService {
  private apiUrl: string;
  private batchSize: number;
  private maxRetries: number;
  
  constructor(
    private db: Database,
    private taskService: TaskService,
    apiUrl: string = process.env.API_BASE_URL || 'http://localhost:3000/api'
  ) {
    this.apiUrl = apiUrl;
    this.batchSize = parseInt(process.env.SYNC_BATCH_SIZE || '50', 10);
    this.maxRetries = parseInt(process.env.SYNC_RETRY_ATTEMPTS || '3', 10);
  }

  async sync(): Promise<SyncResult> {
    const result: SyncResult = {
      success: true,
      synced_items: 0,
      failed_items: 0,
      errors: [],
    };

    try {
      // Check connectivity first
      const isOnline = await this.checkConnectivity();
      if (!isOnline) {
        result.success = false;
        result.errors.push({
          task_id: 'N/A',
          operation: 'connectivity',
          error: 'Server is not reachable',
          timestamp: new Date(),
        });
        return result;
      }

      // Get all items from sync queue
      const queueItems = await this.getSyncQueueItems();
      
      if (queueItems.length === 0) {
        return result;
      }

      // Process items in batches
      for (let i = 0; i < queueItems.length; i += this.batchSize) {
        const batch = queueItems.slice(i, i + this.batchSize);
        
        try {
          const batchResponse = await this.processBatch(batch);
          
          // Handle each item in the batch response
          for (const processedItem of batchResponse.processed_items) {
            if (processedItem.status === 'success') {
              await this.updateSyncStatus(
                processedItem.client_id,
                'synced',
                { server_id: processedItem.server_id }
              );
              result.synced_items++;
              
              // Remove from sync queue
              await this.removeFromSyncQueue(processedItem.client_id);
            } else if (processedItem.status === 'conflict') {
              // Handle conflict resolution
              const localTask = await this.taskService.getTask(processedItem.client_id);
              if (localTask && processedItem.resolved_data) {
                const resolved = await this.resolveConflict(
                  localTask,
                  processedItem.resolved_data
                );
                await this.updateSyncStatus(processedItem.client_id, 'synced', resolved);
                result.synced_items++;
                
                result.errors.push({
                  task_id: processedItem.client_id,
                  operation: 'conflict',
                  error: 'Conflict resolved using last-write-wins',
                  timestamp: new Date(),
                });
                
                await this.removeFromSyncQueue(processedItem.client_id);
              }
            } else {
              // Handle error
              const queueItem = batch.find(item => item.task_id === processedItem.client_id);
              if (queueItem) {
                await this.handleSyncError(
                  queueItem,
                  new Error(processedItem.error || 'Unknown error')
                );
              }
              result.failed_items++;
              result.errors.push({
                task_id: processedItem.client_id,
                operation: queueItem?.operation || 'unknown',
                error: processedItem.error || 'Unknown error',
                timestamp: new Date(),
              });
            }
          }
        } catch (error) {
          // Batch failed entirely
          result.success = false;
          result.failed_items += batch.length;
          
          for (const item of batch) {
            await this.handleSyncError(item, error as Error);
            result.errors.push({
              task_id: item.task_id,
              operation: item.operation,
              error: (error as Error).message,
              timestamp: new Date(),
            });
          }
        }
      }
    } catch (error) {
      result.success = false;
      result.errors.push({
        task_id: 'N/A',
        operation: 'sync',
        error: (error as Error).message,
        timestamp: new Date(),
      });
    }

    return result;
  }

  async addToSyncQueue(
    taskId: string,
    operation: 'create' | 'update' | 'delete',
    data: Partial<Task>
  ): Promise<void> {
    const id = uuidv4();
    const createdAt = new Date();

    await this.db.run(
      `INSERT INTO sync_queue (id, task_id, operation, data, created_at, retry_count)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        taskId,
        operation,
        JSON.stringify(data),
        createdAt.toISOString(),
        0,
      ]
    );
  }

  private async getSyncQueueItems(): Promise<SyncQueueItem[]> {
    const rows = await this.db.all(
      `SELECT * FROM sync_queue ORDER BY created_at ASC`
    );

    return rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      task_id: row.task_id as string,
      operation: row.operation as 'create' | 'update' | 'delete',
      data: JSON.parse(row.data as string) as Partial<Task>,
      created_at: new Date(row.created_at as string),
      retry_count: row.retry_count as number,
      error_message: row.error_message as string | undefined,
    }));
  }

  private async processBatch(items: SyncQueueItem[]): Promise<BatchSyncResponse> {
    const request: BatchSyncRequest = {
      items,
      client_timestamp: new Date(),
    };

    const response = await axios.post(`${this.apiUrl}/batch`, request, {
      timeout: 30000,
    });

    return response.data;
  }

  private async resolveConflict(localTask: Task, serverTask: Task): Promise<Task> {
    // Last-write-wins strategy
    const localTime = new Date(localTask.updated_at).getTime();
    const serverTime = new Date(serverTask.updated_at).getTime();

    if (localTime > serverTime) {
      console.log(`Conflict: Local task ${localTask.id} is newer, keeping local version`);
      return localTask;
    } else if (serverTime > localTime) {
      console.log(`Conflict: Server task ${localTask.id} is newer, using server version`);
      return serverTask;
    } else {
      // Timestamps are equal, prefer server version
      console.log(`Conflict: Equal timestamps for task ${localTask.id}, using server version`);
      return serverTask;
    }
  }

  private async updateSyncStatus(
    taskId: string,
    status: 'synced' | 'error',
    serverData?: Partial<Task>
  ): Promise<void> {
    const updates: string[] = ['sync_status = ?', 'last_synced_at = ?'];
    const values: (string | number | boolean)[] = [status, new Date().toISOString()];

    if (serverData?.server_id) {
      updates.push('server_id = ?');
      values.push(serverData.server_id);
    }

    values.push(taskId);

    await this.db.run(
      `UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`,
      values
    );
  }

  private async handleSyncError(item: SyncQueueItem, error: Error): Promise<void> {
    const newRetryCount = item.retry_count + 1;

    if (newRetryCount >= this.maxRetries) {
      // Mark task as permanently failed
      await this.db.run(
        `UPDATE tasks SET sync_status = ? WHERE id = ?`,
        ['error', item.task_id]
      );
      
      // Keep in sync queue but mark as failed
      await this.db.run(
        `UPDATE sync_queue SET retry_count = ?, error_message = ? WHERE id = ?`,
        [newRetryCount, error.message, item.id]
      );
    } else {
      // Increment retry count
      await this.db.run(
        `UPDATE sync_queue SET retry_count = ?, error_message = ? WHERE id = ?`,
        [newRetryCount, error.message, item.id]
      );
    }
  }

  private async removeFromSyncQueue(taskId: string): Promise<void> {
    await this.db.run(`DELETE FROM sync_queue WHERE task_id = ?`, [taskId]);
  }

  async checkConnectivity(): Promise<boolean> {
    try {
      await axios.get(`${this.apiUrl}/health`, { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  async getPendingSyncCount(): Promise<number> {
    const result = await this.db.get(
      `SELECT COUNT(*) as count FROM sync_queue`
    );
    return (result.count as number) || 0;
  }

  async getLastSyncTimestamp(): Promise<Date | null> {
    const result = await this.db.get(
      `SELECT MAX(last_synced_at) as last_sync FROM tasks WHERE last_synced_at IS NOT NULL`
    );
    return result.last_sync ? new Date(result.last_sync as string) : null;
  }
}