import { v4 as uuidv4 } from 'uuid';
import { Task } from '../types';
import { Database } from '../db/database';

export class TaskService {
  constructor(private db: Database) {}

  async createTask(taskData: Partial<Task>): Promise<Task> {
    const id = uuidv4();
    const now = new Date().toISOString();
    
    const task: Task = {
      id,
      title: taskData.title || '',
      description: taskData.description || '',
      completed: false,
      created_at: new Date(now),
      updated_at: new Date(now),
      is_deleted: false,
      sync_status: 'pending',
      server_id: undefined,
      last_synced_at: undefined,
    };

    await this.db.run(
      `INSERT INTO tasks (id, title, description, completed, created_at, updated_at, is_deleted, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        task.id,
        task.title,
        task.description || '',
        task.completed ? 1 : 0,
        now,
        now,
        0,
        'pending',
      ]
    );

    // Add to sync queue after creating task
    await this.addToSyncQueue(task.id, 'create', task);

    return task;
  }

  async updateTask(id: string, updates: Partial<Task>): Promise<Task | null> {
    const existingTask = await this.getTask(id);
    if (!existingTask) {
      return null;
    }

    const now = new Date().toISOString();
    const updateFields: string[] = [];
    const values: (string | number | boolean)[] = [];

    if (updates.title !== undefined) {
      updateFields.push('title = ?');
      values.push(updates.title);
    }
    if (updates.description !== undefined) {
      updateFields.push('description = ?');
      values.push(updates.description);
    }
    if (updates.completed !== undefined) {
      updateFields.push('completed = ?');
      values.push(updates.completed ? 1 : 0);
    }

    updateFields.push('updated_at = ?', 'sync_status = ?');
    values.push(now, 'pending');
    values.push(id);

    await this.db.run(
      `UPDATE tasks SET ${updateFields.join(', ')} WHERE id = ?`,
      values
    );

    const updatedTask = await this.getTask(id);
    
    // Add to sync queue after updating task
    if (updatedTask) {
      await this.addToSyncQueue(id, 'update', updatedTask);
    }

    return updatedTask;
  }

  async deleteTask(id: string): Promise<boolean> {
    const task = await this.getTask(id);
    if (!task) {
      return false;
    }

    const now = new Date().toISOString();
    await this.db.run(
      `UPDATE tasks SET is_deleted = ?, updated_at = ?, sync_status = ? WHERE id = ?`,
      [1, now, 'pending', id]
    );

    // Add to sync queue after marking as deleted
    await this.addToSyncQueue(id, 'delete', task);

    return true;
  }

  async getTask(id: string): Promise<Task | null> {
    const row = await this.db.get(
      'SELECT * FROM tasks WHERE id = ? AND is_deleted = 0',
      [id]
    );

    if (!row || !row.id) {
      return null;
    }

    return this.mapRowToTask(row);
  }

  async getAllTasks(): Promise<Task[]> {
    const rows = await this.db.all(
      'SELECT * FROM tasks WHERE is_deleted = 0 ORDER BY created_at DESC'
    );

    return rows.map(this.mapRowToTask);
  }

  async getTasksNeedingSync(): Promise<Task[]> {
    const rows = await this.db.all(
      `SELECT * FROM tasks WHERE sync_status IN ('pending', 'error') AND is_deleted = 0`
    );

    return rows.map(this.mapRowToTask);
  }

  private async addToSyncQueue(
    taskId: string,
    operation: 'create' | 'update' | 'delete',
    data: Partial<Task>
  ): Promise<void> {
    const queueItem = {
      id: uuidv4(),
      task_id: taskId,
      operation,
      data,
      created_at: new Date(),
      retry_count: 0,
    };

    await this.db.run(
      `INSERT INTO sync_queue (id, task_id, operation, data, created_at, retry_count)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        queueItem.id,
        queueItem.task_id,
        queueItem.operation,
        JSON.stringify(queueItem.data),
        queueItem.created_at.toISOString(),
        queueItem.retry_count,
      ]
    );
  }

  private mapRowToTask(row: Record<string, unknown>): Task {
    return {
      id: row.id as string,
      title: row.title as string,
      description: (row.description as string) || '',
      completed: row.completed === 1,
      created_at: new Date(row.created_at as string),
      updated_at: new Date(row.updated_at as string),
      is_deleted: row.is_deleted === 1,
      sync_status: row.sync_status as 'pending' | 'synced' | 'error',
      server_id: row.server_id as string | undefined,
      last_synced_at: row.last_synced_at ? new Date(row.last_synced_at as string) : undefined,
    };
  }
}