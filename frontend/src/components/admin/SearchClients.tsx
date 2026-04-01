import React, { useEffect, useMemo, useState } from "react"
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline"
import { apiClient } from "../../lib/apiClient"

interface ClientRow {
  id: number
  name: string
  ip_address?: string
  plan?: string
  status?: string
  email?: string
  portal_access?: boolean
}

interface ImportPreview {
  client_id?: number
  name?: string
  email?: string | null
  plan_id?: number
  plan_name?: string
  router_id?: number | null
  connection_type?: string
  portal_access?: boolean
  changes?: string[]
  password?: string
}

interface ImportResultRow {
  row: number
  success: boolean
  error?: string
  client_id?: number
  name?: string
  email?: string
  preview?: ImportPreview
}

interface ImportSummary {
  dryRun: boolean
  requested: number
  successCount: number
  failedCount: number
}

const detectDelimiter = (headerLine: string): string => {
  const commaCount = (headerLine.match(/,/g) || []).length
  const semicolonCount = (headerLine.match(/;/g) || []).length
  return semicolonCount > commaCount ? ";" : ","
}

const parseDelimitedRows = (content: string, delimiter: string): string[][] => {
  const rows: string[][] = []
  let currentRow: string[] = []
  let currentField = ""
  let inQuotes = false

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]
    const nextChar = content[index + 1]

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentField += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (!inQuotes && char === delimiter) {
      currentRow.push(currentField)
      currentField = ""
      continue
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && nextChar === "\n") {
        index += 1
      }
      currentRow.push(currentField)
      const normalized = currentRow.map((item) => item.trim())
      if (normalized.some((item) => item.length > 0)) {
        rows.push(normalized)
      }
      currentRow = []
      currentField = ""
      continue
    }

    currentField += char
  }

  currentRow.push(currentField)
  const normalized = currentRow.map((item) => item.trim())
  if (normalized.some((item) => item.length > 0)) {
    rows.push(normalized)
  }

  return rows
}

const parseCsvObjects = (content: string): Record<string, unknown>[] => {
  const clean = content.replace(/^\uFEFF/, "")
  const firstLine = clean.split(/\r?\n/, 1)[0] || ""
  const delimiter = detectDelimiter(firstLine)
  const rows = parseDelimitedRows(clean, delimiter)
  if (rows.length < 2) return []

  const headers = rows[0].map((header) => header.trim().toLowerCase())
  const payload: Record<string, unknown>[] = []

  for (const row of rows.slice(1)) {
    const item: Record<string, unknown> = {}
    headers.forEach((header, columnIndex) => {
      if (!header) return
      const value = (row[columnIndex] || "").trim()
      if (value.length > 0) {
        item[header] = value
      }
    })
    if (Object.keys(item).length > 0) {
      payload.push(item)
    }
  }

  return payload
}

const SearchClients: React.FC = () => {
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [rows, setRows] = useState<ClientRow[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [runningBulk, setRunningBulk] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [feedback, setFeedback] = useState("")

  const [importRows, setImportRows] = useState<Record<string, unknown>[]>([])
  const [importFileName, setImportFileName] = useState("")
  const [importLoading, setImportLoading] = useState(false)
  const [importFeedback, setImportFeedback] = useState("")
  const [importResults, setImportResults] = useState<ImportResultRow[]>([])
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null)

  const [updateRows, setUpdateRows] = useState<Record<string, unknown>[]>([])
  const [updateFileName, setUpdateFileName] = useState("")
  const [updateLoading, setUpdateLoading] = useState(false)
  const [updateFeedback, setUpdateFeedback] = useState("")
  const [updateResults, setUpdateResults] = useState<ImportResultRow[]>([])
  const [updateSummary, setUpdateSummary] = useState<ImportSummary | null>(null)

  const loadRows = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (statusFilter) params.set("status", statusFilter)
      const endpoint = params.toString() ? `/admin/clients?${params.toString()}` : "/admin/clients"
      const response = (await apiClient.get(endpoint)) as { items?: ClientRow[] }
      setRows((response.items || []) as ClientRow[])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadRows()
  }, [statusFilter])

  const filtered = useMemo(
    () =>
      rows.filter((clientRow) => {
        const token = query.toLowerCase().trim()
        if (!token) return true
        return (
          (clientRow.name || "").toLowerCase().includes(token) ||
          String(clientRow.id).includes(token) ||
          (clientRow.ip_address || "").toLowerCase().includes(token) ||
          (clientRow.email || "").toLowerCase().includes(token)
        )
      }),
    [rows, query]
  )

  const allFilteredSelected = filtered.length > 0 && filtered.every((row) => selectedIds.includes(row.id))

  const toggleRow = (clientId: number) => {
    setSelectedIds((previous) =>
      previous.includes(clientId) ? previous.filter((id) => id !== clientId) : [...previous, clientId]
    )
  }

  const toggleAllFiltered = () => {
    setSelectedIds((previous) => {
      if (allFilteredSelected) {
        return previous.filter((id) => !filtered.some((row) => row.id === id))
      }
      const merged = new Set(previous)
      filtered.forEach((row) => merged.add(row.id))
      return Array.from(merged.values())
    })
  }

  const runBulkAction = async (action: "suspend" | "activate") => {
    if (selectedIds.length === 0) {
      setFeedback("Selecciona al menos un cliente.")
      return
    }

    setRunningBulk(true)
    setFeedback("")
    try {
      const response = (await apiClient.post("/admin/clients/bulk-action", {
        action,
        client_ids: selectedIds,
      })) as { success_count?: number; failed_count?: number }
      await loadRows()
      setSelectedIds([])
      setFeedback(
        `${action === "suspend" ? "Suspension" : "Reactivacion"} masiva completada: ${Number(
          response.success_count || 0
        )} OK, ${Number(response.failed_count || 0)} fallidos.`
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo ejecutar la accion masiva."
      setFeedback(message)
    } finally {
      setRunningBulk(false)
    }
  }

  const exportCsv = async () => {
    setExporting(true)
    setFeedback("")
    try {
      const params = new URLSearchParams({ format: "csv" })
      if (query.trim()) params.set("q", query.trim())
      if (statusFilter) params.set("status", statusFilter)
      const csv = (await apiClient.get(`/admin/clients/export?${params.toString()}`)) as string
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `clientes-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`
      link.click()
      window.URL.revokeObjectURL(url)
      setFeedback("Exportacion CSV lista.")
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo exportar CSV."
      setFeedback(message)
    } finally {
      setExporting(false)
    }
  }

  const downloadCsvTemplate = () => {
    const template = [
      "name,plan_id,plan_name,router_id,router_name,connection_type,ip_address,email,create_portal_access,password,pppoe_username,pppoe_password",
      "Cliente Demo,1,,,Router Principal,pppoe,,cliente.demo@isp.local,true,,,",
    ].join("\n")
    const blob = new Blob([template], { type: "text/csv;charset=utf-8" })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "clientes-template.csv"
    link.click()
    window.URL.revokeObjectURL(url)
  }

  const onImportFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setImportFileName(file.name)
    setImportResults([])
    setImportSummary(null)
    setImportFeedback("")

    try {
      const raw = await file.text()
      const parsed = parseCsvObjects(raw)
      setImportRows(parsed)
      if (parsed.length === 0) {
        setImportFeedback("El archivo no tiene filas validas para importar.")
      } else {
        setImportFeedback(`Archivo cargado: ${parsed.length} filas listas.`)
      }
    } catch {
      setImportRows([])
      setImportFeedback("No se pudo leer el archivo CSV.")
    }
  }

  const runClientImport = async (dryRun: boolean) => {
    if (importRows.length === 0) {
      setImportFeedback("Carga un archivo CSV con filas validas.")
      return
    }

    setImportLoading(true)
    setImportFeedback("")
    try {
      const response = (await apiClient.post("/admin/clients/bulk-create", {
        dry_run: dryRun,
        rows: importRows,
      })) as {
        dry_run?: boolean
        requested?: number
        success_count?: number
        failed_count?: number
        results?: ImportResultRow[]
      }

      const summary: ImportSummary = {
        dryRun: Boolean(response.dry_run),
        requested: Number(response.requested || 0),
        successCount: Number(response.success_count || 0),
        failedCount: Number(response.failed_count || 0),
      }
      setImportSummary(summary)
      setImportResults((response.results || []) as ImportResultRow[])
      setImportFeedback(
        `${summary.dryRun ? "Validacion" : "Importacion"} completada: ${summary.successCount} OK, ${summary.failedCount} con error.`
      )

      if (!summary.dryRun && summary.successCount > 0) {
        await loadRows()
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo ejecutar la importacion."
      setImportFeedback(message)
    } finally {
      setImportLoading(false)
    }
  }

  const downloadUpdateCsvTemplate = () => {
    const template = [
      "client_id,client_email,plan_id,plan_name,router_id,router_name,connection_type,ip_address,create_portal_access,portal_email,portal_password,reset_portal_password",
      "1,,2,,,,pppoe,10.0.0.20,true,cliente.actualizado@isp.local,,false",
    ].join("\n")
    const blob = new Blob([template], { type: "text/csv;charset=utf-8" })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "clientes-update-template.csv"
    link.click()
    window.URL.revokeObjectURL(url)
  }

  const onUpdateFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setUpdateFileName(file.name)
    setUpdateResults([])
    setUpdateSummary(null)
    setUpdateFeedback("")

    try {
      const raw = await file.text()
      const parsed = parseCsvObjects(raw)
      setUpdateRows(parsed)
      if (parsed.length === 0) {
        setUpdateFeedback("El archivo no tiene filas validas para actualizar.")
      } else {
        setUpdateFeedback(`Archivo cargado: ${parsed.length} filas listas para actualizar.`)
      }
    } catch {
      setUpdateRows([])
      setUpdateFeedback("No se pudo leer el archivo CSV de actualizacion.")
    }
  }

  const runClientBulkUpdate = async (dryRun: boolean) => {
    if (updateRows.length === 0) {
      setUpdateFeedback("Carga un archivo CSV con filas validas.")
      return
    }

    setUpdateLoading(true)
    setUpdateFeedback("")
    try {
      const response = (await apiClient.post("/admin/clients/bulk-update", {
        dry_run: dryRun,
        rows: updateRows,
      })) as {
        dry_run?: boolean
        requested?: number
        success_count?: number
        failed_count?: number
        results?: ImportResultRow[]
      }

      const summary: ImportSummary = {
        dryRun: Boolean(response.dry_run),
        requested: Number(response.requested || 0),
        successCount: Number(response.success_count || 0),
        failedCount: Number(response.failed_count || 0),
      }
      setUpdateSummary(summary)
      setUpdateResults((response.results || []) as ImportResultRow[])
      setUpdateFeedback(
        `${summary.dryRun ? "Validacion" : "Actualizacion"} completada: ${summary.successCount} OK, ${summary.failedCount} con error.`
      )

      if (!summary.dryRun && summary.successCount > 0) {
        await loadRows()
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo ejecutar la actualizacion."
      setUpdateFeedback(message)
    } finally {
      setUpdateLoading(false)
    }
  }

  return (
    <div className="space-y-4 bg-white rounded-xl border border-gray-200 shadow-sm p-6">
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-900">Importacion masiva por CSV</h3>
          <button
            type="button"
            onClick={downloadCsvTemplate}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700"
          >
            Descargar template
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input type="file" accept=".csv,text/csv" onChange={onImportFileSelected} className="text-sm" />
          {importFileName && <span className="text-xs text-gray-600">Archivo: {importFileName}</span>}
          {importRows.length > 0 && <span className="text-xs text-gray-600">Filas: {importRows.length}</span>}
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Columnas soportadas: name, plan_id o plan_name, router_id o router_name, connection_type, ip_address, email,
          create_portal_access, password, pppoe_username, pppoe_password.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => runClientImport(true)}
            disabled={importLoading || importRows.length === 0}
            className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Validar lote (dry run)
          </button>
          <button
            type="button"
            onClick={() => runClientImport(false)}
            disabled={importLoading || importRows.length === 0}
            className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            Importar lote
          </button>
          {importFeedback && <span className="text-sm text-slate-600">{importFeedback}</span>}
        </div>

        {importSummary && (
          <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-700">
            <p>
              Modo: <span className="font-semibold">{importSummary.dryRun ? "Validacion" : "Importacion"}</span> | Solicitadas:
              <span className="font-semibold"> {importSummary.requested}</span> | OK:
              <span className="font-semibold text-emerald-700"> {importSummary.successCount}</span> | Error:
              <span className="font-semibold text-rose-700"> {importSummary.failedCount}</span>
            </p>
          </div>
        )}

        {importResults.length > 0 && (
          <div className="mt-3 max-h-56 overflow-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-2 py-2 text-left">Fila</th>
                  <th className="px-2 py-2 text-left">Estado</th>
                  <th className="px-2 py-2 text-left">Detalle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {importResults.map((item) => (
                  <tr key={`import-${item.row}-${item.name || item.client_id || "row"}`}>
                    <td className="px-2 py-2">{item.row}</td>
                    <td className="px-2 py-2">
                      <span className={item.success ? "text-emerald-700" : "text-rose-700"}>
                        {item.success ? "OK" : "Error"}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-gray-700">
                      {item.error ||
                        item.name ||
                        item.preview?.name ||
                        (item.client_id ? `Cliente ID ${item.client_id}` : "Sin detalle")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-900">Actualizacion masiva por CSV</h3>
          <button
            type="button"
            onClick={downloadUpdateCsvTemplate}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700"
          >
            Descargar template update
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input type="file" accept=".csv,text/csv" onChange={onUpdateFileSelected} className="text-sm" />
          {updateFileName && <span className="text-xs text-gray-600">Archivo: {updateFileName}</span>}
          {updateRows.length > 0 && <span className="text-xs text-gray-600">Filas: {updateRows.length}</span>}
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Columnas soportadas: client_id o client_email, plan_id o plan_name, router_id o router_name, connection_type,
          ip_address, create_portal_access, portal_email, portal_password, reset_portal_password.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => runClientBulkUpdate(true)}
            disabled={updateLoading || updateRows.length === 0}
            className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Validar update (dry run)
          </button>
          <button
            type="button"
            onClick={() => runClientBulkUpdate(false)}
            disabled={updateLoading || updateRows.length === 0}
            className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            Ejecutar update
          </button>
          {updateFeedback && <span className="text-sm text-slate-600">{updateFeedback}</span>}
        </div>

        {updateSummary && (
          <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-700">
            <p>
              Modo: <span className="font-semibold">{updateSummary.dryRun ? "Validacion" : "Actualizacion"}</span> | Solicitadas:
              <span className="font-semibold"> {updateSummary.requested}</span> | OK:
              <span className="font-semibold text-emerald-700"> {updateSummary.successCount}</span> | Error:
              <span className="font-semibold text-rose-700"> {updateSummary.failedCount}</span>
            </p>
          </div>
        )}

        {updateResults.length > 0 && (
          <div className="mt-3 max-h-56 overflow-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-2 py-2 text-left">Fila</th>
                  <th className="px-2 py-2 text-left">Estado</th>
                  <th className="px-2 py-2 text-left">Detalle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {updateResults.map((item) => (
                  <tr key={`update-${item.row}-${item.name || item.client_id || "row"}`}>
                    <td className="px-2 py-2">{item.row}</td>
                    <td className="px-2 py-2">
                      <span className={item.success ? "text-emerald-700" : "text-rose-700"}>
                        {item.success ? "OK" : "Error"}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-gray-700">
                      {item.error ||
                        item.name ||
                        item.preview?.name ||
                        (item.preview?.changes?.length ? item.preview.changes.join(", ") : "") ||
                        (item.client_id ? `Cliente ID ${item.client_id}` : "Sin detalle")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mb-1 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-[260px] flex-1 items-center gap-3">
            <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" />
            <input
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-blue-500"
              placeholder="Buscar por nombre, ID, IP o email"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">Todos los estados</option>
            <option value="active">Activos</option>
            <option value="past_due">Mora</option>
            <option value="suspended">Suspendidos</option>
            <option value="cancelled">Cancelados</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => runBulkAction("suspend")}
            disabled={runningBulk || selectedIds.length === 0}
            className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            Suspender seleccionados ({selectedIds.length})
          </button>
          <button
            type="button"
            onClick={() => runBulkAction("activate")}
            disabled={runningBulk || selectedIds.length === 0}
            className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            Reactivar seleccionados ({selectedIds.length})
          </button>
          <button
            type="button"
            onClick={exportCsv}
            disabled={exporting || loading}
            className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Exportar CSV
          </button>
          {feedback && <span className="text-sm text-slate-600">{feedback}</span>}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-700">
            <tr>
              <th className="px-3 py-2 text-left">
                <input type="checkbox" checked={allFilteredSelected} onChange={toggleAllFiltered} />
              </th>
              <th className="px-3 py-2 text-left">ID</th>
              <th className="px-3 py-2 text-left">Nombre</th>
              <th className="px-3 py-2 text-left">Email</th>
              <th className="px-3 py-2 text-left">IP</th>
              <th className="px-3 py-2 text-left">Plan</th>
              <th className="px-3 py-2 text-left">Estado</th>
              <th className="px-3 py-2 text-left">Portal</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr>
                <td colSpan={8} className="px-3 py-4 text-center text-gray-500">
                  Cargando...
                </td>
              </tr>
            )}
            {!loading &&
              filtered.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggleRow(item.id)} />
                  </td>
                  <td className="px-3 py-2 font-semibold">{item.id}</td>
                  <td className="px-3 py-2">{item.name}</td>
                  <td className="px-3 py-2">{item.email || "-"}</td>
                  <td className="px-3 py-2">{item.ip_address || "-"}</td>
                  <td className="px-3 py-2">{item.plan || "-"}</td>
                  <td className="px-3 py-2 capitalize">{item.status || "-"}</td>
                  <td className="px-3 py-2">{item.portal_access ? "Si" : "No"}</td>
                </tr>
              ))}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-4 text-center text-gray-500">
                  Sin resultados
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default SearchClients
