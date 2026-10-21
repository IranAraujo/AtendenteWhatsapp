import logger from '../utils/logger.js';
// @ts-nocheck
import { dbRepository, DbAppointmentItem, DbTenantItem } from './db.service.js';
import { whatsappService } from './whatsapp.service.js';

export class ReminderService {
  private timer: NodeJS.Timeout | null = null;

  startScheduler(intervalMs = 60 * 1000) {
    if (this.timer) return;
    logger.info('⏰ [Reminder Service] Agendador de lembretes automáticos iniciado (verificação a cada 1 minuto).');
    this.timer = setInterval(() => {
      this.checkAndDispatchReminders().catch(err => {
        logger.error(' [Reminder Service] Erro na rotina de verificação:', err.message);
      });
    }, intervalMs);

    // Executa uma checagem inicial após 5 segundos
    setTimeout(() => {
      this.checkAndDispatchReminders().catch(err => logger.error(err.message));
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
        custom24hText: 'Olá {nome}! Passando para lembrar do seu agendamento amanhã ({data}) às {horario} com {profissional}. \n\nResponda:\n*1* para ✅ CONFIRMAR\n*2* para ❌ CANCELAR\n*3* para 🔄 REAGENDAR',
        enable1hReminder: true,
        custom1hText: 'Olá {nome}! Seu atendimento é daqui a 1 hora às {horario} com {profissional}. \n\nResponda:\n*1* para ✅ CONFIRMAR\n*2* para ❌ CANCELAR'
      };

      if (!config.enable24hReminder && !config.enable1hReminder) {
        continue;
      }

      const allAppts = await dbRepository.getAllAppointments(tenant.id);
      const windowStart = now.getTime() - 15 * 60000;
      const windowEnd = now.getTime() + 26 * 60 * 60000;
      const activeAppts = allAppts.filter((a: any) => {
        if (a.status !== 'CONFIRMED') return false;
        const t = new Date(a.startTime).getTime();
        return t >= windowStart && t <= windowEnd;
      });
      const profs = await dbRepository.listProfessionals(tenant.id);
      const services = await dbRepository.listServices(tenant.id);

      const tz = tenant.timezone || 'America/Sao_Paulo';

      for (const appt of activeAppts) {
        const apptTime = new Date(appt.startTime);
        const diffMinutes = Math.floor((apptTime.getTime() - now.getTime()) / (1000 * 60));

        const prof = profs.find((p: any) => p.id === appt.professionalId) || profs[0];
        const srv = services.find((s: any) => s.id === appt.serviceId) || services[0];

        let dateStr = '';
        let timeStr = '';
        try {
          const timeParts = new Intl.DateTimeFormat('pt-BR', {
            timeZone: tz,
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
          }).formatToParts(apptTime);
          const d = timeParts.find(p => p.type === 'day')?.value;
          const m = timeParts.find(p => p.type === 'month')?.value;
          const h = timeParts.find(p => p.type === 'hour')?.value;
          const min = timeParts.find(p => p.type === 'minute')?.value;
          dateStr = `${d}/${m}`;
          timeStr = `${h}:${min}`;
        } catch {
          dateStr = `${String(apptTime.getDate()).padStart(2, '0')}/${String(apptTime.getMonth() + 1).padStart(2, '0')}`;
          timeStr = `${String(apptTime.getHours()).padStart(2, '0')}:${String(apptTime.getMinutes()).padStart(2, '0')}`;
        }

        // Lembrete 24 Horas / 1 Dia Antes (entre 23h30m e 24h30m -> 1410 a 1470 minutos)
        if (config.enable24hReminder && !appt.reminder24hSent && diffMinutes >= 1410 && diffMinutes <= 1470) {
          const rawText = config.custom24hText || 'Olá {nome}! Lembrando do seu agendamento amanhã ({data}) às {horario} com {profissional}. ';
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
            logger.info(`[Reminder Service] Lembrete 24h enviado com sucesso para ${appt.customerName} (${appt.customerPhone})`);
          }
        }

        // Lembrete 1 Hora Antes (entre 50 min e 70 min antes -> 50 a 70 minutos)
        if (config.enable1hReminder && !appt.reminder1hSent && diffMinutes >= 50 && diffMinutes <= 70) {
          const rawText = config.custom1hText || 'Olá {nome}! Seu atendimento é daqui a 1 hora às {horario} com {profissional}. ';
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
            logger.info(`[Reminder Service] Lembrete 1h enviado com sucesso para ${appt.customerName} (${appt.customerPhone})`);
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
