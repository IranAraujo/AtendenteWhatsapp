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
    customerProfiles = [];
    waitlist = [];
    scheduleBlocks = [];
    constructor() {
        const isVercel = !!process.env.VERCEL || process.env.NODE_ENV === 'production';
        const baseDir = isVercel ? '/tmp' : process.cwd();
        const dataDir = path.join(baseDir, 'data');
        if (!fs.existsSync(dataDir)) {
            try {
                fs.mkdirSync(dataDir, { recursive: true });
            }
            catch (e) { }
        }
        this.dataFilePath = path.join(dataDir, 'database.json');
        if (isVercel && !fs.existsSync(this.dataFilePath)) {
            const origPath = path.join(process.cwd(), 'data', 'database.json');
            if (fs.existsSync(origPath)) {
                try {
                    fs.copyFileSync(origPath, this.dataFilePath);
                }
                catch (e) { }
            }
        }
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
                this.customerProfiles = parsed.customerProfiles || [];
                this.waitlist = parsed.waitlist || [];
                this.scheduleBlocks = parsed.scheduleBlocks || [];
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
                customerProfiles: this.customerProfiles,
                waitlist: this.waitlist,
                scheduleBlocks: this.scheduleBlocks,
                appointments: this.inMemoryAppointments.map(a => ({
                    ...a,
                    startTime: a.startTime.toISOString(),
                    endTime: a.endTime.toISOString()
                }))
            };
            const jsonContent = JSON.stringify(dataToSave, null, 2);
            fs.writeFileSync(this.dataFilePath, jsonContent, 'utf-8');
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
        if ((tenant.planTier === 'FREE' || tenant.planTier === 'SINGLE_USER') && currentUsers.length >= 1) {
            return { success: false, message: 'O plano Grátis/Individual permite apenas 1 usuário. Faça o upgrade para o plano Multi-User para adicionar mais membros da equipe.' };
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
    async updateUserInTenant(tenantId, userId, updates) {
        const tenant = await this.getTenantById(tenantId);
        if (!tenant)
            return { success: false, message: 'Estabelecimento não encontrado.' };
        const user = tenant.users.find(u => u.id === userId);
        if (!user)
            return { success: false, message: 'Usuário não encontrado.' };
        if (updates.name)
            user.name = updates.name;
        if (updates.email)
            user.email = updates.email;
        if (updates.role)
            user.role = updates.role;
        if (updates.password && updates.password.trim())
            user.passwordHash = updates.password.trim();
        // Atualiza também o nome no objeto Professional vinculado se existir
        const prof = this.professionals.find(p => p.tenantId === tenantId && (p.userId === userId || p.id === user.professionalId));
        if (prof && updates.name) {
            prof.name = updates.name;
        }
        this.saveData();
        return { success: true, user };
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
    async listAppointments(tenantId) {
        return this.getAllAppointments(tenantId);
    }
    async getAppointmentsForProfessional(professionalId, dateStr) {
        return this.inMemoryAppointments.filter(a => {
            if (a.professionalId !== professionalId)
                return false;
            if (a.status === 'CANCELLED')
                return false;
            // BUG 4 FIX: usar fuso de Brasília para comparar datas (toISOString() retorna UTC)
            const st = (a.startTime instanceof Date) ? a.startTime : new Date(a.startTime);
            const parts = new Intl.DateTimeFormat('en-CA', {
                timeZone: 'America/Sao_Paulo',
                year: 'numeric', month: '2-digit', day: '2-digit'
            }).formatToParts(st);
            const apptDateStr = `${parts.find(p => p.type === 'year')?.value}-${parts.find(p => p.type === 'month')?.value}-${parts.find(p => p.type === 'day')?.value}`;
            return apptDateStr === dateStr;
        });
    }
    async findUserById(userId) {
        for (const tenant of this.tenants) {
            const u = (tenant.users || []).find(user => user.id === userId);
            if (u)
                return { user: u, tenant };
        }
        return null;
    }
    async listActiveAppointmentsByPhone(tenantId, customerPhone) {
        const cleanToFind = customerPhone.replace(/\D/g, '');
        return this.inMemoryAppointments.filter(a => {
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
    async findActiveAppointmentByPhone(tenantId, customerPhone) {
        const appts = await this.listActiveAppointmentsByPhone(tenantId, customerPhone);
        return appts.length > 0 ? appts[0] : undefined;
    }
    async updateAppointmentTime(appointmentId, newStartTime, newEndTime, newCustomerName) {
        const index = this.inMemoryAppointments.findIndex(a => a.id === appointmentId);
        if (index !== -1) {
            this.inMemoryAppointments[index].startTime = newStartTime;
            this.inMemoryAppointments[index].endTime = newEndTime;
            if (newCustomerName)
                this.inMemoryAppointments[index].customerName = newCustomerName;
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
        const validStart = (data.startTime instanceof Date && !isNaN(data.startTime.getTime())) ? data.startTime : new Date();
        const validEnd = (data.endTime instanceof Date && !isNaN(data.endTime.getTime())) ? data.endTime : new Date(validStart.getTime() + 30 * 60000);
        const existingAppt = await this.findActiveAppointmentByPhone(data.tenantId, data.customerPhone);
        if (existingAppt) {
            existingAppt.startTime = validStart;
            existingAppt.endTime = validEnd;
            if (data.customerName)
                existingAppt.customerName = data.customerName;
            existingAppt.status = 'CONFIRMED';
            this.saveData();
            return existingAppt;
        }
        const newAppointment = {
            id: `appt-${Date.now()}`,
            ...data,
            startTime: validStart,
            endTime: validEnd
        };
        this.inMemoryAppointments.push(newAppointment);
        this.saveData();
        return newAppointment;
    }
    async createAdditionalAppointment(data) {
        const validStart = (data.startTime instanceof Date && !isNaN(data.startTime.getTime())) ? data.startTime : new Date();
        const validEnd = (data.endTime instanceof Date && !isNaN(data.endTime.getTime())) ? data.endTime : new Date(validStart.getTime() + 30 * 60000);
        const newAppointment = {
            id: `appt-${Date.now()}`,
            ...data,
            startTime: validStart,
            endTime: validEnd
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
    // -------------------------------------------------------
    // PERFIS DE CLIENTES (preferências + histórico de visitas)
    // -------------------------------------------------------
    async getCustomerProfile(tenantId, customerPhone) {
        const clean = customerPhone.replace(/\D/g, '');
        return this.customerProfiles.find(p => p.tenantId === tenantId && p.phone === clean);
    }
    async upsertCustomerProfile(tenantId, customerPhone, updates) {
        const clean = customerPhone.replace(/\D/g, '');
        let profile = this.customerProfiles.find(p => p.tenantId === tenantId && p.phone === clean);
        if (!profile) {
            profile = { phone: clean, tenantId, visitCount: 0 };
            this.customerProfiles.push(profile);
        }
        if (updates.name && !profile.name)
            profile.name = updates.name;
        if (updates.preferredProfId)
            profile.preferredProfId = updates.preferredProfId;
        if (updates.preferredServiceId)
            profile.preferredServiceId = updates.preferredServiceId;
        if (updates.visitCount !== undefined)
            profile.visitCount = updates.visitCount;
        if (updates.lastVisitDate)
            profile.lastVisitDate = updates.lastVisitDate;
        this.saveData();
        return profile;
    }
    async incrementVisitCount(tenantId, customerPhone, professionalId, serviceId) {
        const clean = customerPhone.replace(/\D/g, '');
        const today = new Date();
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        await this.upsertCustomerProfile(tenantId, clean, {
            visitCount: ((await this.getCustomerProfile(tenantId, clean))?.visitCount || 0) + 1,
            lastVisitDate: todayStr,
            preferredProfId: professionalId,
            preferredServiceId: serviceId
        });
    }
    // -------------------------------------------------------
    // LISTA DE ESPERA
    // -------------------------------------------------------
    async addToWaitlist(data) {
        // Remove existing entry for same phone+date if any
        this.waitlist = this.waitlist.filter(w => !(w.tenantId === data.tenantId && w.customerPhone === data.customerPhone && w.dateStr === data.dateStr));
        const item = {
            id: `wait-${Date.now()}`,
            ...data,
            createdAt: new Date().toISOString()
        };
        this.waitlist.push(item);
        this.saveData();
        return item;
    }
    async getWaitlistForDate(tenantId, dateStr, professionalId) {
        return this.waitlist.filter(w => {
            if (w.tenantId !== tenantId || w.dateStr !== dateStr)
                return false;
            if (professionalId && w.professionalId && w.professionalId !== professionalId)
                return false;
            return true;
        });
    }
    async getAllWaitlist(tenantId) {
        return this.waitlist.filter(w => w.tenantId === tenantId);
    }
    async removeFromWaitlist(waitlistId) {
        const initial = this.waitlist.length;
        this.waitlist = this.waitlist.filter(w => w.id !== waitlistId);
        if (this.waitlist.length !== initial) {
            this.saveData();
            return true;
        }
        return false;
    }
    async removeFromWaitlistByPhone(tenantId, customerPhone) {
        const clean = customerPhone.replace(/\D/g, '');
        const initial = this.waitlist.length;
        this.waitlist = this.waitlist.filter(w => !(w.tenantId === tenantId && w.customerPhone.replace(/\D/g, '') === clean));
        if (this.waitlist.length !== initial) {
            this.saveData();
            return true;
        }
        return false;
    }
    // -------------------------------------------------------
    // BLOQUEIOS DE AGENDA
    // -------------------------------------------------------
    async addScheduleBlock(data) {
        const block = { id: `block-${Date.now()}`, ...data };
        this.scheduleBlocks.push(block);
        this.saveData();
        return block;
    }
    async getScheduleBlocks(tenantId, professionalId, dateStr) {
        return this.scheduleBlocks.filter(b => {
            if (b.tenantId !== tenantId)
                return false;
            if (professionalId && b.professionalId !== professionalId)
                return false;
            if (dateStr && b.dateStr !== dateStr)
                return false;
            return true;
        });
    }
    async removeScheduleBlock(blockId) {
        const initial = this.scheduleBlocks.length;
        this.scheduleBlocks = this.scheduleBlocks.filter(b => b.id !== blockId);
        if (this.scheduleBlocks.length !== initial) {
            this.saveData();
            return true;
        }
        return false;
    }
    // -------------------------------------------------------
    // LIMITE DIÁRIO DE AGENDAMENTOS POR PROFISSIONAL & TENANT
    // -------------------------------------------------------
    async getDailyAppointmentCount(professionalId, dateStr) {
        const appts = await this.getAppointmentsForProfessional(professionalId, dateStr);
        return appts.filter(a => a.status !== 'CANCELLED').length;
    }
    async getDailyAppointmentCountForTenant(tenantId, dateStr) {
        return this.inMemoryAppointments.filter(a => {
            if (a.tenantId !== tenantId)
                return false;
            if (a.status === 'CANCELLED')
                return false;
            const st = (a.startTime instanceof Date) ? a.startTime : new Date(a.startTime);
            const parts = new Intl.DateTimeFormat('en-CA', {
                timeZone: 'America/Sao_Paulo',
                year: 'numeric', month: '2-digit', day: '2-digit'
            }).formatToParts(st);
            const apptDateStr = `${parts.find(p => p.type === 'year')?.value}-${parts.find(p => p.type === 'month')?.value}-${parts.find(p => p.type === 'day')?.value}`;
            return apptDateStr === dateStr;
        }).length;
    }
    getTenantDailyAppointmentLimit(tenant) {
        if (!tenant)
            return undefined;
        if (tenant.planTier === 'FREE')
            return 5; // Limite de 5 agendamentos por dia no plano Free
        return undefined; // Ilimitado para Starter e Pro
    }
    // -------------------------------------------------------
    // CADASTRO DE NOVO TENANT & PROPRIETÁRIO (SAAS ONBOARDING)
    // -------------------------------------------------------
    async registerTenantAndOwner(data) {
        const cleanEmail = data.email.toLowerCase().trim();
        const existing = await this.findUserByEmail(cleanEmail);
        if (existing) {
            throw new Error('Este e-mail já está cadastrado em nossa plataforma. Por favor, faça login ou use outro e-mail.');
        }
        const timestamp = Date.now();
        const tenantId = `tenant-${timestamp}`;
        const userId = `usr-${timestamp}`;
        const profId = `prof-${timestamp}`;
        let baseSlug = data.companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        if (!baseSlug)
            baseSlug = `empresa-${timestamp}`;
        let slug = baseSlug;
        if (this.tenants.some(t => t.slug === slug)) {
            slug = `${baseSlug}-${Math.floor(100 + Math.random() * 900)}`;
        }
        const plan = data.planTier || 'FREE';
        const maxUsers = plan === 'FREE' || plan === 'SINGLE_USER' ? 1 : 5;
        let systemPrompt = `Somos a ${data.companyName}. Atenda os clientes com profissionalismo, agilidade e excelência no agendamento de horários.`;
        if (data.segment === 'barbearia') {
            systemPrompt = `Somos a ${data.companyName}, uma barbearia moderna. Atenda o cliente com agilidade, simpatia e foco na excelência dos cortes masculinos e barba.`;
        }
        else if (data.segment === 'salao') {
            systemPrompt = `Somos a ${data.companyName}, um salão de beleza completo. Atenda os clientes com muito acolhimento, simpatia e foco em cortes, penteados e estética.`;
        }
        else if (data.segment === 'clinica' || data.segment === 'estetica') {
            systemPrompt = `Somos a ${data.companyName}, clínica de estética e saúde. Atenda os pacientes com extrema cordialidade, profissionalismo e atenção aos procedimentos.`;
        }
        const businessInfo = `Horário de Atendimento: Segunda a Sábado das 08h às 19h.${data.businessAddress ? ` Endereço: ${data.businessAddress}.` : ''}`;
        const ownerUser = {
            id: userId,
            tenantId,
            name: data.ownerName.trim(),
            email: cleanEmail,
            passwordHash: hashPassword(data.password),
            role: 'OWNER',
            professionalId: profId
        };
        const newTenant = {
            id: tenantId,
            name: data.companyName.trim(),
            slug,
            ownerEmail: cleanEmail,
            planTier: plan,
            maxUsers,
            status: 'ACTIVE',
            aiConfig: {
                systemPrompt,
                businessInfo,
                voiceId: 'pt-BR-FranciscaNeural',
                voiceReplyMode: 'WHEN_AUDIO_RECEIVED',
                faqItems: [
                    { question: 'Quais as formas de pagamento aceitas?', answer: 'Aceitamos Pix, cartão de débito, crédito e dinheiro.' },
                    { question: 'Onde fica o estabelecimento?', answer: data.businessAddress ? `Ficamos localizados em: ${data.businessAddress}` : 'Consulte nosso endereço diretamente no painel ou com a nossa equipe.' }
                ]
            },
            bookingRules: {
                bufferTimeMinutes: 10,
                minimumNoticeMinutes: 0,
                maxFutureDays: 30,
                roundRobinEnabled: true
            },
            remindersConfig: {
                enable24hReminder: true,
                enable1hReminder: true
            },
            users: [ownerUser]
        };
        // Gera serviços iniciais padrão com base no segmento
        const initialServicesData = [];
        if (data.segment === 'barbearia') {
            initialServicesData.push({ name: 'Corte de Cabelo', price: 45.0, durationMinutes: 30, description: 'Corte tradicional ou degradê na tesoura/máquina' }, { name: 'Barba Completa', price: 35.0, durationMinutes: 30, description: 'Modelagem de barba com toalha quente e navalha' }, { name: 'Combo Cabelo + Barba', price: 70.0, durationMinutes: 50, description: 'Corte completo com tratamento de barba' });
        }
        else if (data.segment === 'salao') {
            initialServicesData.push({ name: 'Corte & Escova', price: 70.0, durationMinutes: 45, description: 'Corte personalizado e finalização com escova' }, { name: 'Hidratação Profunda', price: 90.0, durationMinutes: 40, description: 'Tratamento capilar intensivo' }, { name: 'Manicure & Pedicure', price: 55.0, durationMinutes: 45, description: 'Cuidado completo para mãos e pés' });
        }
        else if (data.segment === 'clinica' || data.segment === 'estetica') {
            initialServicesData.push({ name: 'Avaliação Inicial', price: 80.0, durationMinutes: 30, description: 'Avaliação clínica e plano de tratamento' }, { name: 'Limpeza de Pele Profunda', price: 130.0, durationMinutes: 60, description: 'Higienização, esfoliação e hidratação facial' }, { name: 'Sessão de Atendimento', price: 150.0, durationMinutes: 45, description: 'Sessão de procedimento especializado' });
        }
        else {
            initialServicesData.push({ name: 'Atendimento Padrão', price: 60.0, durationMinutes: 30, description: 'Sessão padrão de atendimento' }, { name: 'Consulta Especializada', price: 120.0, durationMinutes: 60, description: 'Atendimento aprofundado e completo' });
        }
        const createdServices = [];
        for (const s of initialServicesData) {
            const created = await this.addService(tenantId, s);
            createdServices.push(created);
        }
        // Cria o primeiro profissional (o próprio proprietário)
        const initialProfessional = {
            id: profId,
            tenantId,
            name: data.ownerName.trim(),
            userId,
            phone: data.phone ? data.phone.replace(/\D/g, '') : undefined,
            workSchedule: {
                startTime: '08:00',
                endTime: '18:00',
                lunchStartTime: '12:00',
                lunchEndTime: '13:00',
                workDays: [1, 2, 3, 4, 5, 6]
            }
        };
        this.professionals.push(initialProfessional);
        this.tenants.push(newTenant);
        this.saveData();
        return {
            tenant: newTenant,
            user: ownerUser,
            initialServices: createdServices,
            initialProfessional
        };
    }
    // -------------------------------------------------------
    // REGRAS DE AGENDAMENTO & ACESSO PÚBLICO
    // -------------------------------------------------------
    async getTenantBySlug(slug) {
        return this.tenants.find(t => t.slug === slug || t.slug.toLowerCase() === slug.toLowerCase());
    }
    async updateTenantBookingRules(tenantId, rules) {
        const tenant = await this.getTenantById(tenantId);
        if (!tenant)
            return undefined;
        tenant.bookingRules = {
            bufferTimeMinutes: 10,
            minimumNoticeMinutes: 0,
            maxFutureDays: 30,
            roundRobinEnabled: true,
            ...(tenant.bookingRules || {}),
            ...rules
        };
        await this.saveTenant(tenant);
        return tenant;
    }
}
export const dbRepository = new DbRepository();
