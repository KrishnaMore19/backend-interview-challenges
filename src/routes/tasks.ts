import { Router, Request, Response } from 'express';
import { TaskService } from '../services/taskService';
import { Database } from '../db/database';
import { Task } from '../types';

export function createTaskRouter(db: Database): Router {
  const router = Router();
  const taskService = new TaskService(db);

  // Get all tasks
  router.get('/', async (req: Request, res: Response) => {
    try {
      const tasks = await taskService.getAllTasks();
      res.json(tasks);
    } catch {
      res.status(500).json({ 
        error: 'Failed to fetch tasks',
        timestamp: new Date().toISOString(),
        path: req.path,
      });
    }
  });

  // Get single task
  router.get('/:id', async (req: Request, res: Response): Promise<void> => {
    try {
      const task = await taskService.getTask(req.params.id);
      if (!task) {
        res.status(404).json({ 
          error: 'Task not found',
          timestamp: new Date().toISOString(),
          path: req.path,
        });
        return;
      }
      res.json(task);
    } catch {
      res.status(500).json({ 
        error: 'Failed to fetch task',
        timestamp: new Date().toISOString(),
        path: req.path,
      });
    }
  });

  // Create task
  router.post('/', async (req: Request, res: Response): Promise<void> => {
    try {
      // Validate request body
      const { title, description } = req.body;
      
      if (!title || typeof title !== 'string' || title.trim().length === 0) {
        res.status(400).json({ 
          error: 'Title is required and must be a non-empty string',
          timestamp: new Date().toISOString(),
          path: req.path,
        });
        return;
      }

      // Create task (sync queue is handled internally by TaskService)
      const task = await taskService.createTask({
        title: title.trim(),
        description: description ? description.trim() : '',
      });

      res.status(201).json(task);
    } catch (error) {
      console.error('Error creating task:', error);
      res.status(500).json({ 
        error: 'Failed to create task',
        timestamp: new Date().toISOString(),
        path: req.path,
      });
    }
  });

  // Update task
  router.put('/:id', async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { title, description, completed } = req.body;

      // Validate at least one field to update
      if (title === undefined && description === undefined && completed === undefined) {
        res.status(400).json({ 
          error: 'At least one field (title, description, or completed) must be provided',
          timestamp: new Date().toISOString(),
          path: req.path,
        });
        return;
      }

      // Validate title if provided
      if (title !== undefined && (typeof title !== 'string' || title.trim().length === 0)) {
        res.status(400).json({ 
          error: 'Title must be a non-empty string',
          timestamp: new Date().toISOString(),
          path: req.path,
        });
        return;
      }

      // Validate completed if provided
      if (completed !== undefined && typeof completed !== 'boolean') {
        res.status(400).json({ 
          error: 'Completed must be a boolean',
          timestamp: new Date().toISOString(),
          path: req.path,
        });
        return;
      }

      // Update task (sync queue is handled internally by TaskService)
      const updates: Partial<Task> = {};
      if (title !== undefined) updates.title = title.trim();
      if (description !== undefined) updates.description = description.trim();
      if (completed !== undefined) updates.completed = completed;

      const updatedTask = await taskService.updateTask(id, updates);

      if (!updatedTask) {
        res.status(404).json({ 
          error: 'Task not found',
          timestamp: new Date().toISOString(),
          path: req.path,
        });
        return;
      }

      res.json(updatedTask);
    } catch (error) {
      console.error('Error updating task:', error);
      res.status(500).json({ 
        error: 'Failed to update task',
        timestamp: new Date().toISOString(),
        path: req.path,
      });
    }
  });

  // Delete task
  router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      // Delete task (sync queue is handled internally by TaskService)
      const success = await taskService.deleteTask(id);

      if (!success) {
        res.status(404).json({ 
          error: 'Task not found',
          timestamp: new Date().toISOString(),
          path: req.path,
        });
        return;
      }

      res.status(204).send();
    } catch (error) {
      console.error('Error deleting task:', error);
      res.status(500).json({ 
        error: 'Failed to delete task',
        timestamp: new Date().toISOString(),
        path: req.path,
      });
    }
  });

  return router;
}