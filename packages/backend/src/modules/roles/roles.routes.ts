import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireMFA } from '../../middleware/requireMFA';
import { authorize } from '../../middleware/authorize';

export const rolesRoutes = Router();
rolesRoutes.use(authenticate, requireMFA);

rolesRoutes.get('/', authorize('security.read'), (_req, res) => {
  res.json({
    success: true,
    data: {
      roles: [],
      count: 0,
    },
  });
});
