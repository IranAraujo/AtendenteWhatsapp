import { Request, Response, NextFunction } from 'express';
import { verifyJwtToken, JwtUserPayload } from '../services/auth.service.js';

export interface AuthenticatedRequest extends Request {
  user?: JwtUserPayload;
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  let token = '';

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.headers.cookie) {
    const cookies = req.headers.cookie.split(';').map(c => c.trim());
    const authCookie = cookies.find(c => c.startsWith('authToken='));
    if (authCookie) {
      token = authCookie.split('=')[1];
    }
  }

  if (!token) {
    return res.status(401).json({ success: false, error: 'Acesso não autorizado. Token JWT de autenticação ausente.' });
  }

  const decoded = verifyJwtToken(token);
  if (!decoded) {
    return res.status(401).json({ success: false, error: 'Token de acesso inválido ou expirado. Por favor, faça login novamente.' });
  }

  req.user = decoded;
  next();
}

export function requireTenantAccess(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ success: false, error: 'Acesso não autorizado.' });
  }

  // Super Admin tem acesso a qualquer tenant
  if (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN') {
    return next();
  }

  // Obter tenantId dos params de forma inteligente
  let requestedTenantId = req.query.tenantId || req.body.tenantId;
  
  if (req.originalUrl.includes('/api/tenants/')) {
    const parts = req.originalUrl.split('/api/tenants/')[1].split('/');
    if (parts[0]) requestedTenantId = parts[0].split('?')[0];
  }

  if (requestedTenantId && requestedTenantId !== user.tenantId && requestedTenantId !== 'null' && requestedTenantId !== 'undefined') {
    return res.status(403).json({ success: false, error: 'Acesso negado a este estabelecimento.' });
  }

  next();
}

// Middleware de RBAC para restringir acesso a recursos do próprio profissional
export async function requireProfessionalOwner(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const user = req.user;
  if (!user) return res.status(401).json({ success: false, error: 'Acesso não autorizado.' });

  // Se for ADMIN, SUPER_ADMIN, OWNER ou RECEPTIONIST, tem acesso livre à agenda do estabelecimento
  if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN' || user.role === 'OWNER' || user.role === 'RECEPTIONIST') {
    return next();
  }

  // Se for PROFISSIONAL, garantimos que qualquer professionalId no body/query/params seja forçado para o dele
  if (user.role === 'PROFESSIONAL') {
    if (!user.professionalId) {
      try {
        const { prisma } = await import('../services/db.service.js');
        const prof = await prisma.professional.findFirst({ where: { userId: user.userId, tenantId: user.tenantId } });
        if (prof) {
          user.professionalId = prof.id;
        }
      } catch (err) {
        console.warn('Erro ao resolver professionalId em requireProfessionalOwner:', err);
      }
    }
    
    if (user.professionalId) {
      req.query.professionalId = user.professionalId; // Força filtro silenciosamente
    }
    if (req.body && req.body.professionalId && req.body.professionalId !== user.professionalId) {
      return res.status(403).json({ success: false, error: 'Você só pode gerenciar seus próprios registros de atendimento.' });
    }
  }

  next();
}

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const role = req.user?.role;
  if (role !== 'ADMIN' && role !== 'SUPER_ADMIN' && role !== 'OWNER') {
    return res.status(403).json({ success: false, error: 'Permissão negada. Esta funcionalidade é restrita ao proprietário do estabelecimento.' });
  }
  next();
}
