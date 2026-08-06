// In-Memory Seed Repository for instant testing and demonstration
export class MemoryRepository {
    tenants = new Map();
    services = new Map();
    professionals = new Map();
    appointments = [];
    constructor() {
        this.seedDefaultData();
    }
    seedDefaultData() {
        const tenantId = 'tenant-demo-barbearia';
        // Seed Tenant
        this.tenants.set(tenantId, {
            id: tenantId,
            name: 'Barbearia Navalha de Ouro',
            slug: 'navalha-de-ouro',
            whatsappInstance: 'instancia-navalha',
            enablePixDeposit: false,
            pixDepositType: 'FIXED',
            pixDepositValue: 15.0,
            aiConfig: {
                systemPrompt: 'Somos uma barbearia moderna e amigável. Trate o cliente como amigo e ofereça nossos principais cortes.',
                businessInfo: 'Endereço: Av. Central, 500 - Centro. Horário: Segunda a Sábado das 08h às 19h.',
            },
        });
        // Seed Services
        const s1 = { id: 'srv-1', tenantId, name: 'Corte de Cabelo', description: 'Corte tesoura/máquina com acabamento', durationMinutes: 30, price: 45.0 };
        const s2 = { id: 'srv-2', tenantId, name: 'Barba Completa', description: 'Modelagem de barba com toalha quente', durationMinutes: 30, price: 35.0 };
        const s3 = { id: 'srv-3', tenantId, name: 'Combo Corte + Barba', description: 'Corte de cabelo e barba completa', durationMinutes: 60, price: 70.0 };
        this.services.set(s1.id, s1);
        this.services.set(s2.id, s2);
        this.services.set(s3.id, s3);
        // Seed Professionals
        const p1 = { id: 'prof-1', tenantId, name: 'Lucas Barbeiro', role: 'PROFESSIONAL', serviceIds: ['srv-1', 'srv-2', 'srv-3'] };
        const p2 = { id: 'prof-2', tenantId, name: 'Matheus Mestre', role: 'PROFESSIONAL', serviceIds: ['srv-1', 'srv-2'] };
        this.professionals.set(p1.id, p1);
        this.professionals.set(p2.id, p2);
    }
    async getTenantById(id) {
        return this.tenants.get(id) || null;
    }
    async getTenantByInstance(instanceName) {
        for (const tenant of this.tenants.values()) {
            if (tenant.whatsappInstance === instanceName)
                return tenant;
        }
        // Fallback default tenant for demo
        return Array.from(this.tenants.values())[0] || null;
    }
    async listServices(tenantId) {
        return Array.from(this.services.values()).filter(s => s.tenantId === tenantId);
    }
    async listProfessionals(tenantId, serviceId) {
        return Array.from(this.professionals.values()).filter(p => {
            if (p.tenantId !== tenantId)
                return false;
            if (serviceId && !p.serviceIds.includes(serviceId))
                return false;
            return true;
        });
    }
    async getAppointmentsForProfessional(professionalId, dateStr) {
        return this.appointments.filter(a => {
            if (a.professionalId !== professionalId)
                return false;
            if (a.status === 'CANCELLED')
                return false;
            const apptDateStr = a.startTime.toISOString().split('T')[0];
            return apptDateStr === dateStr;
        });
    }
    async createAppointment(appt) {
        const newAppt = {
            ...appt,
            id: `appt-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        };
        this.appointments.push(newAppt);
        return newAppt;
    }
}
export const dbRepository = new MemoryRepository();
