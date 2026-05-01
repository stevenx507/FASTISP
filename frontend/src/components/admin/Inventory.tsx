import React, { useCallback, useEffect, useState } from 'react'
import {
  ArrowPathIcon,
  ExclamationTriangleIcon,
  PlusIcon,
  PencilSquareIcon,
  TrashIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  AdjustmentsHorizontalIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { apiClient } from '../../lib/apiClient'

type Tab = 'resumen' | 'productos' | 'proveedores' | 'kardex'

interface Product {
  id: number
  name: string
  sku: string
  description: string
  category_id: number | null
  supplier_id: number | null
  unit_cost: number
  unit_price: number
  stock_quantity: number
  current_stock?: number
  min_stock_level: number
  max_stock_level: number | null
  location: string
}

interface Supplier {
  id: number
  name: string
  contact_email: string
  contact_phone: string
  address: string
}

interface Movement {
  id: number
  product_id: number
  product_name?: string
  movement_type: 'in' | 'out' | 'adjustment'
  quantity: number
  reason: string
  reference: string
  unit_cost: number
  notes: string
  created_at: string
}

const EMPTY_PRODUCT: Omit<Product, 'id'> = {
  name: '', sku: '', description: '', category_id: null, supplier_id: null,
  unit_cost: 0, unit_price: 0, stock_quantity: 0, min_stock_level: 0,
  max_stock_level: null, location: '',
}
const EMPTY_SUPPLIER: Omit<Supplier, 'id'> = { name: '', contact_email: '', contact_phone: '', address: '' }

const mvTypeBadge: Record<string, string> = {
  in: 'bg-emerald-100 text-emerald-700',
  out: 'bg-rose-500/20 text-rose-400',
  adjustment: 'bg-blue-500/20 text-blue-300',
}
const mvTypeLabel: Record<string, string> = { in: '▲ Entrada', out: '▼ Salida', adjustment: '⇄ Ajuste' }

function stockBadge(qty: number, min: number) {
  if (qty <= 0) return 'bg-rose-500/20 text-rose-400'
  if (qty <= min) return 'bg-amber-100 text-amber-700'
  return 'bg-emerald-100 text-emerald-700'
}

const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement> & { label: string }> = ({ label, ...props }) => (
  <div>
    <label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>
    <input {...props} className="w-full rounded-lg border border-white/20 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none" />
  </div>
)

const Textarea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }> = ({ label, ...props }) => (
  <div>
    <label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>
    <textarea {...props} rows={2} className="w-full rounded-lg border border-white/20 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none" />
  </div>
)

const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
    <div className="w-full max-w-lg rounded-2xl bg-white backdrop-blur-md shadow-2xl">
      <div className="flex items-center justify-between border-b px-5 py-4">
        <h3 className="text-base font-semibold text-white">{title}</h3>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-500 text-xl leading-none">×</button>
      </div>
      <div className="max-h-[75vh] overflow-y-auto p-5">{children}</div>
    </div>
  </div>
)

const Inventory: React.FC = () => {
  const [tab, setTab] = useState<Tab>('resumen')
  const [loading, setLoading] = useState(false)

  const [products, setProducts] = useState<Product[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [movements, setMovements] = useState<Movement[]>([])
  const [lowStock, setLowStock] = useState<Product[]>([])

  const [searchProduct, setSearchProduct] = useState('')
  const [mvFilter, setMvFilter] = useState<'' | 'in' | 'out' | 'adjustment'>('')

  const [productModal, setProductModal] = useState<{ open: boolean; editing: Product | null }>({ open: false, editing: null })
  const [productForm, setProductForm] = useState<Omit<Product, 'id'>>({ ...EMPTY_PRODUCT })
  const [productSaving, setProductSaving] = useState(false)

  const [supplierModal, setSupplierModal] = useState<{ open: boolean; editing: Supplier | null }>({ open: false, editing: null })
  const [supplierForm, setSupplierForm] = useState<Omit<Supplier, 'id'>>({ ...EMPTY_SUPPLIER })
  const [supplierSaving, setSupplierSaving] = useState(false)

  const [movementModal, setMovementModal] = useState(false)
  const [mvForm, setMvForm] = useState({ product_id: '', movement_type: 'in', quantity: '', reason: '', reference: '', notes: '', unit_cost: '' })
  const [mvSaving, setMvSaving] = useState(false)

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [pRes, sRes, mRes] = await Promise.all([
        apiClient.get('/admin/inventory/products'),
        apiClient.get('/admin/inventory/suppliers'),
        apiClient.get('/admin/inventory/movements'),
      ])
      const prods = (pRes.items || []) as Product[]
      setProducts(prods)
      setSuppliers((sRes.suppliers || sRes.items || []) as Supplier[])
      setMovements((mRes.items || []) as Movement[])
      setLowStock(prods.filter(p => (p.stock_quantity ?? p.current_stock ?? 0) <= p.min_stock_level))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error cargando inventario')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  const openAddProduct = () => { setProductForm({ ...EMPTY_PRODUCT }); setProductModal({ open: true, editing: null }) }
  const openEditProduct = (p: Product) => {
    setProductForm({ name: p.name, sku: p.sku, description: p.description || '', category_id: p.category_id, supplier_id: p.supplier_id, unit_cost: p.unit_cost, unit_price: p.unit_price, stock_quantity: p.stock_quantity ?? p.current_stock ?? 0, min_stock_level: p.min_stock_level, max_stock_level: p.max_stock_level, location: p.location || '' })
    setProductModal({ open: true, editing: p })
  }
  const saveProduct = async () => {
    if (!productForm.name.trim()) { toast.error('Nombre requerido'); return }
    setProductSaving(true)
    try {
      const body = { ...productForm, current_stock: productForm.stock_quantity }
      if (productModal.editing) {
        await apiClient.patch(`/admin/inventory/products/${productModal.editing.id}`, body)
        toast.success('Producto actualizado')
      } else {
        await apiClient.post('/admin/inventory/products', body)
        toast.success('Producto creado')
      }
      setProductModal({ open: false, editing: null })
      await loadAll()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error guardando producto')
    } finally {
      setProductSaving(false)
    }
  }
  const deleteProduct = async (p: Product) => {
    if (!confirm(`¿Eliminar producto "${p.name}"?`)) return
    try {
      await apiClient.delete(`/admin/inventory/products/${p.id}`)
      toast.success('Producto eliminado')
      await loadAll()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo eliminar')
    }
  }

  const openAddSupplier = () => { setSupplierForm({ ...EMPTY_SUPPLIER }); setSupplierModal({ open: true, editing: null }) }
  const openEditSupplier = (s: Supplier) => { setSupplierForm({ name: s.name, contact_email: s.contact_email || '', contact_phone: s.contact_phone || '', address: s.address || '' }); setSupplierModal({ open: true, editing: s }) }
  const saveSupplier = async () => {
    if (!supplierForm.name.trim()) { toast.error('Nombre requerido'); return }
    setSupplierSaving(true)
    try {
      if (supplierModal.editing) {
        await apiClient.patch(`/admin/inventory/suppliers/${supplierModal.editing.id}`, supplierForm)
        toast.success('Proveedor actualizado')
      } else {
        await apiClient.post('/admin/inventory/suppliers', supplierForm)
        toast.success('Proveedor creado')
      }
      setSupplierModal({ open: false, editing: null })
      await loadAll()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error guardando proveedor')
    } finally {
      setSupplierSaving(false)
    }
  }
  const deleteSupplier = async (s: Supplier) => {
    if (!confirm(`¿Eliminar proveedor "${s.name}"?`)) return
    try {
      await apiClient.delete(`/admin/inventory/suppliers/${s.id}`)
      toast.success('Proveedor eliminado')
      await loadAll()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo eliminar')
    }
  }

  const saveMovement = async () => {
    if (!mvForm.product_id || !mvForm.quantity) { toast.error('Producto y cantidad requeridos'); return }
    setMvSaving(true)
    try {
      await apiClient.post('/admin/inventory/movements', {
        product_id: Number(mvForm.product_id),
        movement_type: mvForm.movement_type,
        quantity: Number(mvForm.quantity),
        reason: mvForm.reason,
        reference: mvForm.reference,
        notes: mvForm.notes,
        unit_cost: mvForm.unit_cost ? Number(mvForm.unit_cost) : undefined,
      })
      toast.success('Movimiento registrado en Kardex')
      setMovementModal(false)
      setMvForm({ product_id: '', movement_type: 'in', quantity: '', reason: '', reference: '', notes: '', unit_cost: '' })
      await loadAll()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error registrando movimiento')
    } finally {
      setMvSaving(false)
    }
  }

  const filteredProducts = products.filter(p => !searchProduct || p.name.toLowerCase().includes(searchProduct.toLowerCase()) || p.sku.toLowerCase().includes(searchProduct.toLowerCase()))
  const filteredMovements = movements.filter(m => !mvFilter || m.movement_type === mvFilter)
  const supplierName = (id: number | null) => suppliers.find(s => s.id === id)?.name || '-'

  const tabs: { id: Tab; label: string }[] = [
    { id: 'resumen', label: 'Resumen' },
    { id: 'productos', label: `Productos (${products.length})` },
    { id: 'proveedores', label: `Proveedores (${suppliers.length})` },
    { id: 'kardex', label: `Kardex (${movements.length})` },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white">Almacén e Inventario</h2>
          <p className="text-sm text-slate-500">Gestión de stock, productos, proveedores y movimientos Kardex.</p>
        </div>
        <button onClick={loadAll} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-white backdrop-blur-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-white disabled:opacity-60">
          <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Cargando...' : 'Actualizar'}
        </button>
      </div>

      {lowStock.length > 0 && (
        <div className="flex flex-wrap gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <ExclamationTriangleIcon className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800">
            <strong>Stock bajo:</strong> {lowStock.map(p => p.name).join(', ')}
          </div>
        </div>
      )}

      <div className="border-b border-gray-200">
        <nav className="flex gap-1">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === t.id ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-600'}`}>
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'resumen' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div className="rounded-xl border border-blue-100 bg-blue-500/10 p-4">
              <p className="text-xs font-semibold uppercase text-blue-600">Productos</p>
              <p className="mt-2 text-3xl font-bold text-blue-200">{products.length}</p>
            </div>
            <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
              <p className="text-xs font-semibold uppercase text-emerald-600">Proveedores</p>
              <p className="mt-2 text-3xl font-bold text-emerald-900">{suppliers.length}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase text-slate-600">Total Movimientos</p>
              <p className="mt-2 text-3xl font-bold text-slate-900">{movements.length}</p>
            </div>
            <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
              <p className="text-xs font-semibold uppercase text-amber-600">Stock Bajo</p>
              <p className="mt-2 text-3xl font-bold text-amber-900">{lowStock.length}</p>
            </div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white backdrop-blur-md shadow-sm overflow-x-auto">
            <div className="border-b border-white/5 px-4 py-3 flex items-center justify-between">
              <h3 className="font-semibold text-white">Estado de Stock</h3>
              <button onClick={() => setTab('productos')} className="text-xs text-blue-600 hover:underline">Ver todos →</button>
            </div>
            <table className="min-w-full divide-y divide-white/5 text-sm">
              <thead className="bg-white text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left">SKU</th>
                  <th className="px-4 py-3 text-left">Producto</th>
                  <th className="px-4 py-3 text-left">Proveedor</th>
                  <th className="px-4 py-3 text-right">Stock</th>
                  <th className="px-4 py-3 text-right">Mínimo</th>
                  <th className="px-4 py-3 text-right">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {products.slice(0, 10).map(p => {
                  const qty = p.stock_quantity ?? p.current_stock ?? 0
                  return (
                    <tr key={p.id} className="hover:bg-white">
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">{p.sku || '-'}</td>
                      <td className="px-4 py-3 font-medium text-white">{p.name}</td>
                      <td className="px-4 py-3 text-slate-500">{supplierName(p.supplier_id)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-white">{qty}</td>
                      <td className="px-4 py-3 text-right text-slate-500">{p.min_stock_level}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${stockBadge(qty, p.min_stock_level)}`}>
                          {qty <= 0 ? 'Sin stock' : qty <= p.min_stock_level ? 'Bajo' : 'OK'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
                {!products.length && <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">Sin productos registrados.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'productos' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <input value={searchProduct} onChange={e => setSearchProduct(e.target.value)} placeholder="Buscar por nombre o SKU..." className="w-full rounded-lg border border-white/20 pl-9 pr-3 py-2 text-sm" />
            </div>
            <button onClick={openAddProduct} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700">
              <PlusIcon className="h-4 w-4" /> Nuevo Producto
            </button>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white backdrop-blur-md shadow-sm overflow-x-auto">
            <table className="min-w-full divide-y divide-white/5 text-sm">
              <thead className="bg-white text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left">SKU</th>
                  <th className="px-4 py-3 text-left">Nombre</th>
                  <th className="px-4 py-3 text-left">Proveedor</th>
                  <th className="px-4 py-3 text-right">Costo</th>
                  <th className="px-4 py-3 text-right">Precio</th>
                  <th className="px-4 py-3 text-right">Stock</th>
                  <th className="px-4 py-3 text-right">Mín.</th>
                  <th className="px-4 py-3 text-left">Ubicación</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filteredProducts.map(p => {
                  const qty = p.stock_quantity ?? p.current_stock ?? 0
                  return (
                    <tr key={p.id} className="hover:bg-white">
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">{p.sku || '-'}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-white">{p.name}</p>
                        {p.description && <p className="text-xs text-slate-500 truncate max-w-[200px]">{p.description}</p>}
                      </td>
                      <td className="px-4 py-3 text-slate-500">{supplierName(p.supplier_id)}</td>
                      <td className="px-4 py-3 text-right text-slate-600">${p.unit_cost.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right text-slate-600">${p.unit_price.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${stockBadge(qty, p.min_stock_level)}`}>{qty}</span>
                      </td>
                      <td className="px-4 py-3 text-right text-slate-500">{p.min_stock_level}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{p.location || '-'}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button onClick={() => openEditProduct(p)} className="rounded p-1 text-slate-500 hover:bg-white/10 hover:text-blue-600"><PencilSquareIcon className="h-4 w-4" /></button>
                          <button onClick={() => deleteProduct(p)} className="rounded p-1 text-slate-500 hover:bg-rose-500/10 hover:text-red-600"><TrashIcon className="h-4 w-4" /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {!filteredProducts.length && <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-slate-500">Sin productos.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'proveedores' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={openAddSupplier} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700">
              <PlusIcon className="h-4 w-4" /> Nuevo Proveedor
            </button>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white backdrop-blur-md shadow-sm overflow-x-auto">
            <table className="min-w-full divide-y divide-white/5 text-sm">
              <thead className="bg-white text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left">Nombre</th>
                  <th className="px-4 py-3 text-left">Email</th>
                  <th className="px-4 py-3 text-left">Teléfono</th>
                  <th className="px-4 py-3 text-left">Dirección</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {suppliers.map(s => (
                  <tr key={s.id} className="hover:bg-white">
                    <td className="px-4 py-3 font-medium text-white">{s.name}</td>
                    <td className="px-4 py-3 text-slate-500">{s.contact_email || '-'}</td>
                    <td className="px-4 py-3 text-slate-500">{s.contact_phone || '-'}</td>
                    <td className="px-4 py-3 text-slate-500 truncate max-w-[200px]">{s.address || '-'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEditSupplier(s)} className="rounded p-1 text-slate-500 hover:bg-white/10 hover:text-blue-600"><PencilSquareIcon className="h-4 w-4" /></button>
                        <button onClick={() => deleteSupplier(s)} className="rounded p-1 text-slate-500 hover:bg-rose-500/10 hover:text-red-600"><TrashIcon className="h-4 w-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!suppliers.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">Sin proveedores registrados.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'kardex' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AdjustmentsHorizontalIcon className="h-4 w-4 text-slate-500" />
              <select value={mvFilter} onChange={e => setMvFilter(e.target.value as typeof mvFilter)} className="rounded-lg border border-white/20 px-3 py-2 text-sm">
                <option value="">Todos los movimientos</option>
                <option value="in">▲ Entradas</option>
                <option value="out">▼ Salidas</option>
                <option value="adjustment">⇄ Ajustes</option>
              </select>
            </div>
            <button onClick={() => setMovementModal(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
              <PlusIcon className="h-4 w-4" /> Registrar Movimiento
            </button>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white backdrop-blur-md shadow-sm overflow-x-auto">
            <table className="min-w-full divide-y divide-white/5 text-sm">
              <thead className="bg-white text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left">Fecha</th>
                  <th className="px-4 py-3 text-left">Tipo</th>
                  <th className="px-4 py-3 text-left">Producto</th>
                  <th className="px-4 py-3 text-right">Cant.</th>
                  <th className="px-4 py-3 text-right">Costo Unit.</th>
                  <th className="px-4 py-3 text-left">Motivo</th>
                  <th className="px-4 py-3 text-left">Referencia</th>
                  <th className="px-4 py-3 text-left">Notas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filteredMovements.map(m => {
                  const prod = products.find(p => p.id === m.product_id)
                  return (
                    <tr key={m.id} className="hover:bg-white">
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">{m.created_at ? new Date(m.created_at).toLocaleString('es') : '-'}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${mvTypeBadge[m.movement_type] || 'bg-white/10 text-slate-500'}`}>
                          {m.movement_type === 'in' ? <ArrowUpIcon className="h-3 w-3" /> : m.movement_type === 'out' ? <ArrowDownIcon className="h-3 w-3" /> : <AdjustmentsHorizontalIcon className="h-3 w-3" />}
                          {mvTypeLabel[m.movement_type] || m.movement_type}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-white">{prod?.name || m.product_name || `#${m.product_id}`}</td>
                      <td className="px-4 py-3 text-right font-semibold text-white">{m.movement_type === 'out' ? '-' : '+'}{m.quantity}</td>
                      <td className="px-4 py-3 text-right text-slate-500">{m.unit_cost ? `$${Number(m.unit_cost).toFixed(2)}` : '-'}</td>
                      <td className="px-4 py-3 text-slate-500">{m.reason || '-'}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{m.reference || '-'}</td>
                      <td className="px-4 py-3 text-xs text-slate-500 truncate max-w-[150px]">{m.notes || '-'}</td>
                    </tr>
                  )
                })}
                {!filteredMovements.length && <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-500">Sin movimientos registrados.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {productModal.open && (
        <Modal title={productModal.editing ? 'Editar Producto' : 'Nuevo Producto'} onClose={() => setProductModal({ open: false, editing: null })}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Input label="Nombre *" value={productForm.name} onChange={e => setProductForm(f => ({ ...f, name: e.target.value }))} placeholder="Ej: Cable UTP Cat6" />
              <Input label="SKU" value={productForm.sku} onChange={e => setProductForm(f => ({ ...f, sku: e.target.value }))} placeholder="Ej: CAB-UTP-C6" />
            </div>
            <Textarea label="Descripción" value={productForm.description} onChange={e => setProductForm(f => ({ ...f, description: e.target.value }))} placeholder="Descripción opcional" />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Costo unitario ($)" type="number" min="0" step="0.01" value={productForm.unit_cost} onChange={e => setProductForm(f => ({ ...f, unit_cost: parseFloat(e.target.value) || 0 }))} />
              <Input label="Precio de venta ($)" type="number" min="0" step="0.01" value={productForm.unit_price} onChange={e => setProductForm(f => ({ ...f, unit_price: parseFloat(e.target.value) || 0 }))} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Input label="Stock actual" type="number" min="0" value={productForm.stock_quantity} onChange={e => setProductForm(f => ({ ...f, stock_quantity: parseInt(e.target.value) || 0 }))} />
              <Input label="Mínimo" type="number" min="0" value={productForm.min_stock_level} onChange={e => setProductForm(f => ({ ...f, min_stock_level: parseInt(e.target.value) || 0 }))} />
              <Input label="Máximo" type="number" min="0" value={productForm.max_stock_level ?? ''} onChange={e => setProductForm(f => ({ ...f, max_stock_level: e.target.value ? parseInt(e.target.value) : null }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Proveedor</label>
                <select value={productForm.supplier_id ?? ''} onChange={e => setProductForm(f => ({ ...f, supplier_id: e.target.value ? Number(e.target.value) : null }))} className="w-full rounded-lg border border-white/20 px-3 py-2 text-sm">
                  <option value="">Sin proveedor</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <Input label="Ubicación en almacén" value={productForm.location} onChange={e => setProductForm(f => ({ ...f, location: e.target.value }))} placeholder="Ej: Estante A-3" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setProductModal({ open: false, editing: null })} className="rounded-lg border border-white/20 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-white">Cancelar</button>
              <button onClick={saveProduct} disabled={productSaving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{productSaving ? 'Guardando...' : productModal.editing ? 'Actualizar' : 'Crear Producto'}</button>
            </div>
          </div>
        </Modal>
      )}

      {supplierModal.open && (
        <Modal title={supplierModal.editing ? 'Editar Proveedor' : 'Nuevo Proveedor'} onClose={() => setSupplierModal({ open: false, editing: null })}>
          <div className="space-y-3">
            <Input label="Nombre *" value={supplierForm.name} onChange={e => setSupplierForm(f => ({ ...f, name: e.target.value }))} placeholder="Nombre del proveedor" />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Email de contacto" type="email" value={supplierForm.contact_email} onChange={e => setSupplierForm(f => ({ ...f, contact_email: e.target.value }))} placeholder="contacto@proveedor.com" />
              <Input label="Teléfono" value={supplierForm.contact_phone} onChange={e => setSupplierForm(f => ({ ...f, contact_phone: e.target.value }))} placeholder="+51 999 999 999" />
            </div>
            <Textarea label="Dirección" value={supplierForm.address} onChange={e => setSupplierForm(f => ({ ...f, address: e.target.value }))} placeholder="Dirección completa" />
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setSupplierModal({ open: false, editing: null })} className="rounded-lg border border-white/20 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-white">Cancelar</button>
              <button onClick={saveSupplier} disabled={supplierSaving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{supplierSaving ? 'Guardando...' : supplierModal.editing ? 'Actualizar' : 'Crear Proveedor'}</button>
            </div>
          </div>
        </Modal>
      )}

      {movementModal && (
        <Modal title="Registrar Movimiento de Inventario" onClose={() => setMovementModal(false)}>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Producto *</label>
              <select value={mvForm.product_id} onChange={e => setMvForm(f => ({ ...f, product_id: e.target.value }))} className="w-full rounded-lg border border-white/20 px-3 py-2 text-sm">
                <option value="">Seleccionar producto...</option>
                {products.map(p => <option key={p.id} value={p.id}>{p.name} (SKU: {p.sku || '-'})</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Tipo *</label>
                <select value={mvForm.movement_type} onChange={e => setMvForm(f => ({ ...f, movement_type: e.target.value }))} className="w-full rounded-lg border border-white/20 px-3 py-2 text-sm">
                  <option value="in">▲ Entrada (compra/devolución)</option>
                  <option value="out">▼ Salida (uso/venta/instalación)</option>
                  <option value="adjustment">⇄ Ajuste de inventario</option>
                </select>
              </div>
              <Input label="Cantidad *" type="number" min="1" value={mvForm.quantity} onChange={e => setMvForm(f => ({ ...f, quantity: e.target.value }))} placeholder="1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Costo unitario ($)" type="number" min="0" step="0.01" value={mvForm.unit_cost} onChange={e => setMvForm(f => ({ ...f, unit_cost: e.target.value }))} placeholder="0.00" />
              <Input label="Referencia" value={mvForm.reference} onChange={e => setMvForm(f => ({ ...f, reference: e.target.value }))} placeholder="Nº orden, factura..." />
            </div>
            <Input label="Motivo" value={mvForm.reason} onChange={e => setMvForm(f => ({ ...f, reason: e.target.value }))} placeholder="Ej: Compra a proveedor, instalación cliente #123" />
            <Textarea label="Notas" value={mvForm.notes} onChange={e => setMvForm(f => ({ ...f, notes: e.target.value }))} placeholder="Observaciones adicionales" />
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setMovementModal(false)} className="rounded-lg border border-white/20 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-white">Cancelar</button>
              <button onClick={saveMovement} disabled={mvSaving} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">{mvSaving ? 'Registrando...' : 'Registrar en Kardex'}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

export default Inventory
