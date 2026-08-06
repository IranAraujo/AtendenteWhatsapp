import { Request, Response, NextFunction } from 'express';
import { verifyJwtToken, JwtUserPayload } from '../services/auth.service.js';

export interface AuthenticatedRequest extends Request {
  user?: JwtUserPayload;
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Acesso não autorizado. Token JWT de autenticação ausente.' });
  }

  const token = authHeader.split(' ')[1];
  const decoded = verifyJwtToken(token);

  if (!decoded) {
    return res.status(401).json({ success: false, error: 'Token de acesso inválido ou expirado. Por favor, faça login novamente.' });
  }

  req.user = decoded;
  next();
}
