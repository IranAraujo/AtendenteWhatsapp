import { dbRepository, DbTenantItem, DbTenantUser } from './db.service.js';

export class AdminService {
  async getAllTenants(): Promise<DbTenantItem[]> {
    return dbRepository.getAllTenants();
  }

  async createTenant(data: {
    name: string;
    ownerEmail: string;
    planTier: 'SINGLE_USER' | 'MULTI_USER';
    maxUsers?: number;
  }): Promise<DbTenantItem> {
    const slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const maxUsers = data.planTier === 'SINGLE_USER' ? 1 : (data.maxUsers || 5);

    const newTenant: DbTenantItem = {
      id: `tenant-${Date.now()}`,
      name: data.name,
      slug: slug || `tenant-${Date.now()}`,
      ownerEmail: data.ownerEmail,
      planTier: data.planTier,
      maxUsers,
      status: 'ACTIVE',
      aiConfig: {
        systemPrompt: `Somos a ${data.name}, uma barbearia moderna. Trate o cliente com simpatia e foco na excelência dos cortes!`,
        businessInfo: 'Horário de Atendimento: Segunda a Sábado das 08h às 19h.'
      },
      users: [
        {
          id: `usr-${Date.now()}`,
          tenantId: `tenant-${Date.now()}`,
          name: data.name + ' (Admin)',
          email: data.ownerEmail,
          passwordHash: '',
          role: 'OWNER'
        }
      ]
    };

    return dbRepository.saveTenant(newTenant);
  }

  async updateTenant(tenantId: string, updates: Partial<DbTenantItem>): Promise<DbTenantItem | null> {
    return dbRepository.updateTenant(tenantId, updates);
  }

  async deleteTenant(tenantId: string): Promise<boolean> {
    return dbRepository.deleteTenant(tenantId);
  }

  async addTenantUser(tenantId: string, user: { name: string; email: string; role: 'PROFESSIONAL' | 'RECEPTIONIST' | 'BARBER' }): Promise<{ success: boolean; message: string; user?: DbTenantUser }> {
    const tenant = await dbRepository.getTenantById(tenantId);
    if (!tenant) return { success: false, message: 'Tenant não encontrado' };

    if (tenant.users.length >= tenant.maxUsers) {
      return {
        success: false,
        message: `Limite de usuários atingido para o plano ${tenant.planTier}! Máximo permitido: ${tenant.maxUsers} usuário(s). Faça upgrade para MULTI_USER.`
      };
    }

    const newUserRole: DbTenantUser['role'] = (user.role === 'BARBER' ? 'PROFESSIONAL' : user.role);

    const newUser: DbTenantUser = {
      id: `usr-${Date.now()}`,
      tenantId,
      name: user.name,
      email: user.email,
      passwordHash: '',
      role: newUserRole
    };

    tenant.users.push(newUser);
    await dbRepository.saveTenant(tenant);
    return { success: true, message: 'Usuário adicionado com sucesso', user: newUser };
  }

  async deleteTenantUser(tenantId: string, userId: string): Promise<boolean> {
    const tenant = await dbRepository.getTenantById(tenantId);
    if (!tenant) return false;

    tenant.users = tenant.users.filter(u => u.id !== userId);
    await dbRepository.saveTenant(tenant);
    return true;
  }
}

export const adminService = new AdminService();
