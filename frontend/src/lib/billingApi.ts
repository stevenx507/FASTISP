import { apiClient } from './apiClient'

export interface InvoiceDTO {
  id: number
  subscription_id: number
  amount: number
  currency: string
  tax_percent: number
  total_amount: number
  status: 'pending' | 'paid' | 'cancelled' | 'overdue'
  due_date: string | null
  created_at?: string | null
  country?: string | null
}

export interface PaymentDTO {
  id: number
  invoice_id: number
  method: string
  reference: string | null
  amount: number
  currency: string
  status: 'pending' | 'paid' | 'failed'
  metadata?: Record<string, unknown> | null
  created_at?: string | null
}

export const billingApi = {
  async listClientInvoices() {
    return apiClient.get('/client/invoices') as Promise<{ items: InvoiceDTO[]; count: number }>
  },

  async changePlan(clientId: number, planId: number, prorate = true) {
    return apiClient.post(`/admin/clients/${clientId}/change_plan`, { plan_id: planId, prorate })
  },

  async manualPayment(invoiceId: number, amount: number, method = 'manual', reference?: string, metadata?: Record<string, unknown>) {
    return apiClient.post('/admin/payments/manual', {
      invoice_id: invoiceId,
      amount,
      method,
      reference,
      metadata,
    }) as Promise<{ invoice: InvoiceDTO; payment: PaymentDTO }>
  },
}
