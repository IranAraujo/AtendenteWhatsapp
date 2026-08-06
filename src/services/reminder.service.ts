import { dbRepository, DbAppointmentItem, DbTenantItem } from './db.service.js';
import { whatsappService } from './whatsapp.service.js';

export class ReminderService {
  private timer: NodeJS.Timeout | null = null;

  startScheduler(intervalMs = 60 * 1000) {
    if (this.timer) return;
    console.log('⏰ [Reminder Service] Agendador de lembretes automáticos iniciado (verificação a cada 1 minuto).');
    this.timer = setInterval(() => {
      this.checkAndDispatchReminders().catch(err => {
        console.error('❌ [Reminder Service] Erro na rotina de verificação:', err.message);
      });
    }, intervalMs);

    // Executa uma checagem inicial após 5 segundos
    setTimeout(() => {
      this.checkAndDispatchReminders().catch(err => console.error(err.message));
    }, 5000);
  }

  stopScheduler() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async checkAndDispatchReminders() {
    const tenants = await dbRepository.getAllTenants();
    const now = new Date();

    for (const tenant of tenants) {
      const config = tenant.remindersConfig || {
        enable24hReminder: true,
        custom24hText: 'Olá {nome}! Passando para lembrar do seu agendamento amanhã ({data}) às {horario} com {profissional}. ✨\n\nResponda *1* para *CONFIRMAR* ou *2* para *CANCELAR*.',
        enable1hReminder: true,
        custom1hText: 'Olá {nome}! Seu atendimento é daqui a 1 hora às {horario} com {profissional}. ✨\n\nResponda *1* para *CONFIRMAR* ou *2* para *CANCELAR*.'
      };

      if (!config.enable24hReminder && !config.enable1hReminder) {
        continue;
      }

      const allAppts = await dbRepository.getAllAppointments(tenant.id);
      const activeAppts = allAppts.filter(a => a.status === 'CONFIRMED');
      const profs = await dbRepository.listProfessionals(tenant.id);
      const services = await dbRepository.listServices(tenant.id);

      for (const appt of activeAppts) {
        const apptTime = new Date(appt.startTime);
        const diffMinutes = Math.floor((apptTime.getTime() - now.getTime()) / (1000 * 60));

        const prof = profs.find(p => p.id === appt.professionalId) || profs[0];
        const srv = services.find(s => s.id === appt.serviceId) || services[0];

        const dateStr = `${String(apptTime.getDate()).padStart(2, '0')}/${String(apptTime.getMonth() + 1).padStart(2, '0')}`;
        const timeStr = `${String(apptTime.getHours()).padStart(2, '0')}:${String(apptTime.getMinutes()).padStart(2, '0')}`;

        // Lembrete 24 Horas / 1 Dia Antes (entre 23h30m e 24h30m -> 1410 a 1470 minutos)
        if (config.enable24hReminder && !appt.reminder24hSent && diffMinutes >= 1410 && diffMinutes <= 1470) {
          const rawText = config.custom24hText || 'Olá {nome}! Lembrando do seu agendamento amanhã ({data}) às {horario} com {profissional}. ✨';
          const messageText = this.interpolate(rawText, {
            nome: appt.customerName || 'Cliente',
            horario: timeStr,
            data: dateStr,
            profissional: prof ? prof.name : 'Atendente',
            servico: srv ? srv.name : 'Atendimento'
          });

          const sent = await whatsappService.sendMessage(tenant.id, appt.customerPhone, messageText);
          if (sent) {
            await dbRepository.markAppointmentReminderSent(appt.id, '24h');
            console.log(`[Reminder Service] Lembrete 24h enviado com sucesso para ${appt.customerName} (${appt.customerPhone})`);
          }
        }

        // Lembrete 1 Hora Antes (entre 50 min e 70 min antes -> 50 a 70 minutos)
        if (config.enable1hReminder && !appt.reminder1hSent && diffMinutes >= 50 && diffMinutes <= 70) {
          const rawText = config.custom1hText || 'Olá {nome}! Seu atendimento é daqui a 1 hora às {horario} com {profissional}. ✨';
          const messageText = this.interpolate(rawText, {
            nome: appt.customerName || 'Cliente',
            horario: timeStr,
            data: dateStr,
            profissional: prof ? prof.name : 'Atendente',
            servico: srv ? srv.name : 'Atendimento'
          });

          const sent = await whatsappService.sendMessage(tenant.id, appt.customerPhone, messageText);
          if (sent) {
            await dbRepository.markAppointmentReminderSent(appt.id, '1h');
            console.log(`[Reminder Service] Lembrete 1h enviado com sucesso para ${appt.customerName} (${appt.customerPhone})`);
          }
        }
      }
    }
  }

  private interpolate(template: string, vars: Record<string, string>): string {
    let result = template;
    for (const [key, val] of Object.entries(vars)) {
      result = result.replace(new RegExp(`\\{${key}\\}`, 'gi'), val);
    }
    return result;
  }
}

export const reminderService = new ReminderService();
