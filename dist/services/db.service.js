import fs from 'fs';
import path from 'path';
import { hashPassword } from './auth.service.js';
class DbRepository {
    dataFilePath;
    tenants = [];
    inMemoryAppointments = [];
    services = [];
    products = [];
    professionals = [];
    constructor() {
        const dataDir = path.join(process.cwd(), 'data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        this.dataFilePath = path.join(dataDir, 'database.json');
        this.loadData();
    }
    loadData() {
        if (fs.existsSync(this.dataFilePath)) {
            try {
                const raw = fs.readFileSync(this.dataFilePath, 'utf-8');
                const parsed = JSON.parse(raw);
                this.tenants = (parsed.tenants || []).map(t => ({
                    ...t,
                    users: (t.users || []).map(u => ({
                        ...u,
                        passwordHash: hashPassword(u.passwordHash)
                    }))
                }));
                this.services = parsed.services || [];
                this.products = parsed.products || [];
                this.professionals = parsed.professionals || [];
                this.inMemoryAppointments = (parsed.appointments || []).map(a => ({
                    ...a,
                    startTime: new Date(a.startTime),
                    endTime: new Date(a.endTime)
                }));
                console.log(`[DB Persistence] Carregados ${this.tenants.length} estabelecimentos, ${this.services.length} serviços, ${this.products.length} produtos e ${this.inMemoryAppointments.length} agendamentos de ${this.dataFilePath}`);
                return;
            }
            catch (err) {
                console.warn('[DB Persistence] Erro ao carregar banco de dados, reiniciando com dados padrão:', err.message);
            }
        }
        // Inicializa dados padrão de estabelecimentos genéricos
        this.tenants = [
            {
                id: 'tenant-demo-estilo',
                name: 'Estilo & Beleza Premium',
                slug: 'estilo-beleza-premium',
                ownerEmail: 'dono@estilobeleza.com.br',
                planTier: 'MULTI_USER',
                maxUsers: 5,
                status: 'ACTIVE',
                enablePixDeposit: true,
                pixDepositValue: 15.00,
                aiConfig: {
                    systemPrompt: 'Somos um centro de estética e beleza moderno. Trate o cliente com cordialidade, simpatia e eficiência.',
                    businessInfo: 'Endereço: Av. Central, 500 - Centro. Horário: Segunda a Sábado das 08h às 19h.'
                },
                users: [
                    { id: 'usr-1', tenantId: 'tenant-demo-estilo', name: 'Lucas Silva', email: 'dono@estilobeleza.com.br', passwordHash: '123456', role: 'OWNER', professionalId: 'prof-1' },
                    { id: 'usr-2', tenantId: 'tenant-demo-estilo', name: 'Matheus Santos', email: 'matheus@estilobeleza.com.br', passwordHash: '123456', role: 'PROFESSIONAL', professionalId: 'prof-2' }
                ]
            },
            {
                id: 'tenant-demo-clinica',
                name: 'Clínica Saúde & Bem Estar',
                slug: 'clinica-saude-bemestar',
                ownerEmail: 'contato@clinicasaude.com.br',
                planTier: 'SINGLE_USER',
                maxUsers: 1,
                status: 'ACTIVE',
                enablePixDeposit: false,
                pixDepositValue: 0,
                aiConfig: {
                    systemPrompt: 'Somos uma clínica de saúde e bem-estar. Trate os pacientes com empatia, respeito e clareza.',
                    businessInfo: 'Endereço: Rua das Flores, 120 - Jardim América. Horário: Segunda a Sexta das 08h às 18h.'
                },
                users: [
                    { id: 'usr-3', tenantId: 'tenant-demo-clinica', name: 'Dra. Ana Paula', email: 'contato@clinicasaude.com.br', passwordHash: '123456', role: 'OWNER', professionalId: 'prof-3' }
                ]
            }
        ];
        this.services = [
            { id: 'srv-1', tenantId: 'tenant-demo-estilo', name: 'Atendimento Estético Completo', price: 80.00, durationMinutes: 45, description: 'Sessão completa de cuidados com pele e cabelo' },
            { id: 'srv-2', tenantId: 'tenant-demo-estilo', name: 'Corte e Modelagem Especial', price: 50.00, durationMinutes: 30, description: 'Corte personalizado e finalização' },
            { id: 'srv-3', tenantId: 'tenant-demo-clinica', name: 'Consulta / Avaliação Geral', price: 120.00, durationMinutes: 60, description: 'Avaliação presencial completa com profissional especializado' }
        ];
        this.products = [
            { id: 'prod-1', tenantId: 'tenant-demo-estilo', name: 'Kit Hidratação Intensiva', price: 59.90, stock: 12, description: 'Creme hidratante e shampoo nutritivo (250ml)' },
            { id: 'prod-2', tenantId: 'tenant-demo-estilo', name: 'Óleo Reparador de Pontas', price: 34.90, stock: 15, description: 'Sérum concentrado reparador de fios (30ml)' }
        ];
        this.professionals = [
            {
                id: 'prof-1',
                tenantId: 'tenant-demo-estilo',
                name: 'Lucas Silva',
                userId: 'usr-1',
                servicesHandled: ['srv-1', 'srv-2'],
                workSchedule: { startTime: '08:00', endTime: '18:00', lunchStartTime: '12:00', lunchEndTime: '13:00', workDays: [1, 2, 3, 4, 5, 6] }
            },
            {
                id: 'prof-2',
                tenantId: 'tenant-demo-estilo',
                name: 'Matheus Santos',
                userId: 'usr-2',
                servicesHandled: ['srv-2'],
                workSchedule: { startTime: '09:00', endTime: '19:00', lunchStartTime: '13:00', lunchEndTime: '14:00', workDays: [1, 2, 3, 4, 5, 6] }
            },
            {
                id: 'prof-3',
                tenantId: 'tenant-demo-clinica',
                name: 'Dra. Ana Paula',
                userId: 'usr-3',
                servicesHandled: ['srv-3'],
                workSchedule: { startTime: '08:00', endTime: '17:00', lunchStartTime: '12:00', lunchEndTime: '13:00', workDays: [1, 2, 3, 4, 5] }
            }
        ];
        this.inMemoryAppointments = [
            {
                id: 'appt-demo-1',
                tenantId: 'tenant-demo-estilo',
                professionalId: 'prof-1',
                serviceId: 'srv-1',
                customerName: 'Carlos Eduardo',
                customerPhone: '5511987654321',
                startTime: new Date(new Date().setHours(14, 0, 0, 0)),
                endTime: new Date(new Date().setHours(14, 45, 0, 0)),
                status: 'CONFIRMED'
            },
            {
                id: 'appt-demo-2',
                tenantId: 'tenant-demo-estilo',
                professionalId: 'prof-2',
                serviceId: 'srv-2',
                customerName: 'Rafael Souza',
                customerPhone: '5511991238877',
                startTime: new Date(new Date().setHours(15, 30, 0, 0)),
                endTime: new Date(new Date().setHours(16, 0, 0, 0)),
                status: 'CONFIRMED'
            }
        ];
        this.saveData();
    }
    saveData() {
        try {
            const dataToSave = {
                tenants: this.tenants,
                services: this.services,
                products: this.products,
                professionals: this.professionals,
                appointments: this.inMemoryAppointments.map(a => ({
                    ...a,
                    startTime: a.startTime.toISOString(),
                    endTime: a.endTime.toISOString()
                }))
            };
            fs.writeFileSync(this.dataFilePath, JSON.stringify(dataToSave, null, 2), 'utf-8');
        }
        catch (err) {
            console.error('[DB Persistence] Erro ao salvar dados no disco:', err.message);
        }
    }
    async getAllTenants() {
        return this.tenants;
    }
    async getTenantById(tenantId) {
        const t = this.tenants.find(item => item.id === tenantId);
        return t || null;
    }
    async saveTenant(tenant) {
        const index = this.tenants.findIndex(t => t.id === tenant.id);
        if (index !== -1) {
            this.tenants[index] = tenant;
        }
        else {
            this.tenants.push(tenant);
        }
        this.saveData();
        return tenant;
    }
    async updateTenant(tenantId, updates) {
        const tenant = this.tenants.find(t => t.id === tenantId);
        if (!tenant)
            return null;
        Object.assign(tenant, updates);
        this.saveData();
        return tenant;
    }
    async deleteTenant(tenantId) {
        const initialLen = this.tenants.length;
        this.tenants = this.tenants.filter(t => t.id !== tenantId);
        if (this.tenants.length !== initialLen) {
            this.saveData();
            return true;
        }
        return false;
    }
    // -------------------------------------------------------------
    // GESTÃO DE USUÁRIOS E AUTENTICAÇÃO DE LOJAS
    // -------------------------------------------------------------
    async findUserByEmail(email) {
        for (const tenant of this.tenants) {
            const u = (tenant.users || []).find(user => user.email.toLowerCase() === email.toLowerCase());
            if (u) {
                return { user: u, tenant };
            }
        }
        return null;
    }
    async addUserToTenant(tenantId, userData) {
        const tenant = await this.getTenantById(tenantId);
        if (!tenant)
            return { success: false, message: 'Estabelecimento não encontrado.' };
        const currentUsers = tenant.users || [];
        if (tenant.planTier === 'SINGLE_USER' && currentUsers.length >= 1) {
            return { success: false, message: 'O plano Single-User permite apenas 1 usuário. Faça o upgrade para o plano Multi-User para adicionar mais membros da equipe.' };
        }
        if (tenant.planTier === 'MULTI_USER' && currentUsers.length >= tenant.maxUsers) {
            return { success: false, message: `Limite máximo de ${tenant.maxUsers} usuários atingido para este plano.` };
        }
        const newUser = {
            id: `usr-${Date.now()}`,
            tenantId,
            ...userData,
            passwordHash: hashPassword(userData.passwordHash)
        };
        tenant.users.push(newUser);
        if (userData.role === 'PROFESSIONAL' || userData.role === 'OWNER') {
            const newProf = {
                id: `prof-${Date.now()}`,
                tenantId,
                name: userData.name,
                userId: newUser.id,
                servicesHandled: [],
                workSchedule: { startTime: '08:00', endTime: '18:00', lunchStartTime: '12:00', lunchEndTime: '13:00', workDays: [1, 2, 3, 4, 5, 6] }
            };
            newUser.professionalId = newProf.id;
            this.professionals.push(newProf);
        }
        this.saveData();
        return { success: true, user: newUser };
    }
    async deleteUserFromTenant(tenantId, userId) {
        const tenant = await this.getTenantById(tenantId);
        if (!tenant)
            return false;
        const initialLen = tenant.users.length;
        tenant.users = tenant.users.filter(u => u.id !== userId);
        this.professionals = this.professionals.filter(p => !(p.tenantId === tenantId && p.userId === userId));
        if (tenant.users.length !== initialLen) {
            this.saveData();
            return true;
        }
        return false;
    }
    // -------------------------------------------------------------
    // GESTÃO DE SERVIÇOS DO ESTABELECIMENTO
    // -------------------------------------------------------------
    async listServices(tenantId) {
        return this.services.filter(s => s.tenantId === tenantId);
    }
    async addService(tenantId, data) {
        const newService = {
            id: `srv-${Date.now()}`,
            tenantId,
            ...data
        };
        this.services.push(newService);
        this.saveData();
        return newService;
    }
    async updateService(tenantId, serviceId, updates) {
        const index = this.services.findIndex(s => s.id === serviceId && s.tenantId === tenantId);
        if (index !== -1) {
            this.services[index] = { ...this.services[index], ...updates };
            this.saveData();
            return this.services[index];
        }
        return null;
    }
    async deleteService(tenantId, serviceId) {
        const initialLen = this.services.length;
        this.services = this.services.filter(s => !(s.id === serviceId && s.tenantId === tenantId));
        if (this.services.length !== initialLen) {
            this.saveData();
            return true;
        }
        return false;
    }
    // -------------------------------------------------------------
    // GESTÃO DE PRODUTOS DO ESTABELECIMENTO
    // -------------------------------------------------------------
    async listProducts(tenantId) {
        return this.products.filter(p => p.tenantId === tenantId);
    }
    async addProduct(tenantId, data) {
        const newProduct = {
            id: `prod-${Date.now()}`,
            tenantId,
            ...data
        };
        this.products.push(newProduct);
        this.saveData();
        return newProduct;
    }
    async updateProduct(tenantId, productId, updates) {
        const index = this.products.findIndex(p => p.id === productId && p.tenantId === tenantId);
        if (index !== -1) {
            this.products[index] = { ...this.products[index], ...updates };
            this.saveData();
            return this.products[index];
        }
        return null;
    }
    async deleteProduct(tenantId, productId) {
        const initialLen = this.products.length;
        this.products = this.products.filter(p => !(p.id === productId && p.tenantId === tenantId));
        if (this.products.length !== initialLen) {
            this.saveData();
            return true;
        }
        return false;
    }
    // -------------------------------------------------------------
    // PROFISSIONAIS, HORÁRIOS E SERVIÇOS ATENDIDOS
    // -------------------------------------------------------------
    async listProfessionals(tenantId, serviceId) {
        let list = this.professionals.filter(p => p.tenantId === tenantId);
        if (serviceId) {
            list = list.filter(p => !p.servicesHandled || p.servicesHandled.length === 0 || p.servicesHandled.includes(serviceId));
        }
        return list;
    }
    async getProfessionalById(tenantId, professionalId) {
        const prof = this.professionals.find(p => p.id === professionalId && p.tenantId === tenantId);
        return prof || null;
    }
    async updateProfessional(tenantId, professionalId, updates) {
        const index = this.professionals.findIndex(p => p.id === professionalId && p.tenantId === tenantId);
        if (index !== -1) {
            this.professionals[index] = { ...this.professionals[index], ...updates };
            this.saveData();
            return this.professionals[index];
        }
        return null;
    }
    async getAllAppointments(tenantId) {
        if (!tenantId)
            return this.inMemoryAppointments;
        return this.inMemoryAppointments.filter(a => a.tenantId === tenantId && a.status !== 'CANCELLED');
    }
    async getAppointmentsForProfessional(professionalId, dateStr) {
        return this.inMemoryAppointments.filter(a => {
            if (a.professionalId !== professionalId)
                return false;
            if (a.status === 'CANCELLED')
                return false;
            const apptDateStr = a.startTime.toISOString().split('T')[0];
            return apptDateStr === dateStr;
        });
    }
    async findActiveAppointmentByPhone(tenantId, customerPhone) {
        const cleanToFind = customerPhone.replace(/\D/g, '');
        return this.inMemoryAppointments.find(a => {
            if (a.tenantId !== tenantId || a.status === 'CANCELLED')
                return false;
            const cleanA = a.customerPhone.replace(/\D/g, '');
            if (cleanA === cleanToFind)
                return true;
            if (cleanA.length === 12 && cleanToFind.length === 13) {
                const altFind = cleanToFind.slice(0, 4) + cleanToFind.slice(5);
                if (cleanA === altFind)
                    return true;
            }
            if (cleanA.length === 13 && cleanToFind.length === 12) {
                const altA = cleanA.slice(0, 4) + cleanA.slice(5);
                if (altA === cleanToFind)
                    return true;
            }
            return false;
        });
    }
    async updateAppointmentTime(appointmentId, newStartTime, newEndTime) {
        const index = this.inMemoryAppointments.findIndex(a => a.id === appointmentId);
        if (index !== -1) {
            this.inMemoryAppointments[index].startTime = newStartTime;
            this.inMemoryAppointments[index].endTime = newEndTime;
            this.inMemoryAppointments[index].status = 'CONFIRMED';
            this.saveData();
            return this.inMemoryAppointments[index];
        }
        return undefined;
    }
    async updateAppointmentDetails(appointmentId, updates) {
        const index = this.inMemoryAppointments.findIndex(a => a.id === appointmentId);
        if (index !== -1) {
            if (updates.startTime)
                this.inMemoryAppointments[index].startTime = new Date(updates.startTime);
            if (updates.endTime)
                this.inMemoryAppointments[index].endTime = new Date(updates.endTime);
            if (updates.customerName)
                this.inMemoryAppointments[index].customerName = updates.customerName;
            if (updates.customerPhone)
                this.inMemoryAppointments[index].customerPhone = updates.customerPhone;
            if (updates.status)
                this.inMemoryAppointments[index].status = updates.status;
            this.saveData();
            return this.inMemoryAppointments[index];
        }
        return null;
    }
    async deleteAppointment(appointmentId) {
        const initialLen = this.inMemoryAppointments.length;
        this.inMemoryAppointments = this.inMemoryAppointments.filter(a => a.id !== appointmentId);
        if (this.inMemoryAppointments.length !== initialLen) {
            this.saveData();
            return true;
        }
        return false;
    }
    async cancelAppointment(appointmentId) {
        const index = this.inMemoryAppointments.findIndex(a => a.id === appointmentId);
        if (index !== -1) {
            this.inMemoryAppointments[index].status = 'CANCELLED';
            this.saveData();
            return true;
        }
        return false;
    }
    async cancelAppointmentByPhone(tenantId, customerPhone) {
        const appt = await this.findActiveAppointmentByPhone(tenantId, customerPhone);
        if (appt) {
            appt.status = 'CANCELLED';
            this.saveData();
            return appt;
        }
        return undefined;
    }
    async confirmAppointmentByPhone(tenantId, customerPhone) {
        const appt = await this.findActiveAppointmentByPhone(tenantId, customerPhone);
        if (appt) {
            appt.status = 'CONFIRMED';
            this.saveData();
            return appt;
        }
        return undefined;
    }
    async createAppointment(data) {
        const existingAppt = await this.findActiveAppointmentByPhone(data.tenantId, data.customerPhone);
        if (existingAppt) {
            existingAppt.startTime = data.startTime;
            existingAppt.endTime = data.endTime;
            if (data.customerName)
                existingAppt.customerName = data.customerName;
            existingAppt.status = 'CONFIRMED';
            this.saveData();
            return existingAppt;
        }
        const newAppointment = {
            id: `appt-${Date.now()}`,
            ...data
        };
        this.inMemoryAppointments.push(newAppointment);
        this.saveData();
        return newAppointment;
    }
    async updateTenantReminders(tenantId, config) {
        const tenant = await this.getTenantById(tenantId);
        if (tenant) {
            tenant.remindersConfig = config;
            this.saveData();
            return true;
        }
        return false;
    }
    async markAppointmentReminderSent(appointmentId, type) {
        const appt = this.inMemoryAppointments.find(a => a.id === appointmentId);
        if (appt) {
            if (type === '24h')
                appt.reminder24hSent = true;
            if (type === '1h')
                appt.reminder1hSent = true;
            this.saveData();
            return true;
        }
        return false;
    }
    async updateUserPassword(userId, newPasswordHash) {
        for (const t of this.tenants) {
            const u = t.users.find(usr => usr.id === userId);
            if (u) {
                u.passwordHash = newPasswordHash;
                this.saveData();
                return true;
            }
        }
        return false;
    }
    async updateTenantPlan(tenantId, planTier) {
        const tenant = await this.getTenantById(tenantId);
        if (!tenant)
            return { success: false, maxUsers: 1 };
        let maxUsers = 1;
        if (planTier === 'MULTI_USER')
            maxUsers = 5;
        if (planTier === 'ENTERPRISE')
            maxUsers = 999;
        tenant.planTier = planTier;
        tenant.maxUsers = maxUsers;
        this.saveData();
        return { success: true, maxUsers };
    }
    async updateTenantBilling(tenantId, billingData) {
        const tenant = await this.getTenantById(tenantId);
        if (!tenant)
            return false;
        tenant.billing = {
            ...tenant.billing,
            ...billingData
        };
        this.saveData();
        return true;
    }
}
export const dbRepository = new DbRepository();
