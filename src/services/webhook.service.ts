import { dbRepository } from './db.service.js';

export type WebhookEventType = 'booking.created' | 'booking.cancelled' | 'booking.rescheduled' | 'ping';

export interface WebhookPayload {
  event: WebhookEventType;
  timestamp: string;
  tenantId: string;
  tenantName: string;
  data: any;
}

export class WebhookService {
  /**
   * Dispara um evento de webhook assíncrono para o endpoint configurado no tenant.
   * Não trava a execução principal e registra logs em caso de falha.
   */
  async dispatch(tenantId: string, event: WebhookEventType, data: any): Promise<boolean> {
    try {
      const tenant = await dbRepository.getTenantById(tenantId);
      const webhookUrl = tenant?.bookingRules?.webhookUrl;

      if (!webhookUrl || !webhookUrl.startsWith('http')) {
        return false;
      }

      const payload: WebhookPayload = {
        event,
        timestamp: new Date().toISOString(),
        tenantId,
        tenantName: tenant?.name || 'SaaS Estabelecimento',
        data
      };

      // Dispara em background
      fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'WhatsApp-SaaS-CalCom-Webhook/1.0',
          'X-Webhook-Event': event
        },
        body: JSON.stringify(payload)
      }).then(res => {
        if (!res.ok) {
          console.warn(`[Webhook Dispatch] Status ${res.status} de ${webhookUrl} para evento ${event}`);
        } else {
          console.log(`[Webhook Dispatch] ✅ Evento ${event} enviado com sucesso para ${webhookUrl}`);
        }
      }).catch(err => {
        console.warn(`[Webhook Dispatch Error] Falha ao enviar para ${webhookUrl}:`, err.message);
      });

      return true;
    } catch (err: any) {
      console.warn('[Webhook Service] Erro geral:', err.message);
      return false;
    }
  }

  /**
   * Envia um teste de ping imediato e aguarda a resposta para confirmação no dashboard.
   */
  async testPing(webhookUrl: string, tenantName: string): Promise<{ success: boolean; status?: number; error?: string }> {
    try {
      const payload: WebhookPayload = {
        event: 'ping',
        timestamp: new Date().toISOString(),
        tenantId: 'test-tenant',
        tenantName: tenantName || 'Teste Estabelecimento',
        data: {
          message: 'Webhook de teste configurado com sucesso! 🎉',
          calComFeatures: ['bufferTimes', 'minimumNotice', 'roundRobin', 'publicBooking']
        }
      };

      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'WhatsApp-SaaS-CalCom-Webhook/1.0',
          'X-Webhook-Event': 'ping'
        },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        return { success: true, status: res.status };
      } else {
        return { success: false, status: res.status, error: `Servidor retornou status HTTP ${res.status}` };
      }
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}

export const webhookService = new WebhookService();
