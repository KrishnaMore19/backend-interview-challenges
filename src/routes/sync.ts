import { Router, Request, Response } from 'express';
import { SyncService } from '../services/syncService';
import { TaskService } from '../services/taskService';
import { Database } from '../db/database';

export function createSyncRouter(db: Database): Router {
  const router = Router();
  const taskService = new TaskService(db);
  const syncService = new SyncService(db, taskService);

  // Trigger manual sync
  router.post('/sync', async (req: Request, res: Response): Promise<void> => {
    try {
      // Check connectivity first
      const isOnline = await syncService.checkConnectivity();
      
      if (!isOnline) {
        res.status(503).json({ 
          error: 'Cannot sync: Server is not reachable',
          timestamp: new Date().toISOString(),
          path: req.path,
        });
        return;
      }

      // Perform sync
      const result = await syncService.sync();

      res.json(result);
    } catch (error) {
      console.error('Error during sync:', error);
      res.status(500).json({ 
        error: 'Sync failed',
        message: (error as Error).message,
        timestamp: new Date().toISOString(),
        path: req.path,
      });
    }
  });

  // Check sync status
  router.get('/status', async (req: Request, res: Response) => {
    try {
      // Get pending sync count
      const pendingCount = await syncService.getPendingSyncCount();
      
      // Get last sync timestamp
      const lastSync = await syncService.getLastSyncTimestamp();
      
      // Check connectivity
      const isOnline = await syncService.checkConnectivity();

      res.json({
        pending_sync_count: pendingCount,
        last_sync_timestamp: lastSync ? lastSync.toISOString() : null,
        is_online: isOnline,
        sync_queue_size: pendingCount,
      });
    } catch (error) {
      console.error('Error getting sync status:', error);
      res.status(500).json({ 
        error: 'Failed to get sync status',
        timestamp: new Date().toISOString(),
        path: req.path,
      });
    }
  });

  // Batch sync endpoint (for server-side)
  router.post('/batch', async (req: Request, res: Response): Promise<void> => {
    try {
      const { items } = req.body;

      // Validate request
      if (!items || !Array.isArray(items)) {
        res.status(400).json({ 
          error: 'Items array is required',
          timestamp: new Date().toISOString(),
          path: req.path,
        });
        return;
      }

      // Process each item in the batch
      const processedItems = [];

      for (const item of items) {
        try {
          let result;

          switch (item.operation) {
            case 'create': {
              // Create task on server
              const createdTask = await taskService.createTask(item.data);
              result = {
                client_id: item.task_id,
                server_id: createdTask.id,
                status: 'success',
                resolved_data: createdTask,
              };
              break;
            }

            case 'update': {
              // Update task on server
              const updatedTask = await taskService.updateTask(item.task_id, item.data);
              if (updatedTask) {
                result = {
                  client_id: item.task_id,
                  server_id: updatedTask.server_id || updatedTask.id,
                  status: 'success',
                  resolved_data: updatedTask,
                };
              } else {
                result = {
                  client_id: item.task_id,
                  server_id: item.task_id,
                  status: 'error',
                  error: 'Task not found',
                };
              }
              break;
            }

            case 'delete': {
              // Delete task on server
              const deleted = await taskService.deleteTask(item.task_id);
              if (deleted) {
                result = {
                  client_id: item.task_id,
                  server_id: item.task_id,
                  status: 'success',
                };
              } else {
                result = {
                  client_id: item.task_id,
                  server_id: item.task_id,
                  status: 'error',
                  error: 'Task not found',
                };
              }
              break;
            }

            default:
              result = {
                client_id: item.task_id,
                server_id: item.task_id,
                status: 'error',
                error: 'Unknown operation',
              };
          }

          processedItems.push(result);
        } catch (error) {
          processedItems.push({
            client_id: item.task_id,
            server_id: item.task_id,
            status: 'error',
            error: (error as Error).message,
          });
        }
      }

      res.json({
        processed_items: processedItems,
      });
    } catch (error) {
      console.error('Error processing batch:', error);
      res.status(500).json({ 
        error: 'Batch processing failed',
        timestamp: new Date().toISOString(),
        path: req.path,
      });
    }
  });

  // Health check endpoint
  router.get('/health', async (_req: Request, res: Response) => {
    res.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}