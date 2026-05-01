import os
import re

file_path = "frontend/src/pages/SstpProvisioning.tsx"
with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# Root container
content = content.replace('bg-gray-950 text-white', 'bg-transparent text-slate-800')

# Modals
content = content.replace('bg-gray-900 border border-gray-700', 'bg-white border border-gray-200 shadow-xl')
content = content.replace('bg-gray-800 rounded-lg p-3', 'bg-gray-50 rounded-lg p-3 border border-gray-100')
content = content.replace('text-white font-semibold', 'text-slate-800 font-bold')
content = content.replace('text-white font-mono', 'text-slate-800 font-mono')
content = content.replace('text-slate-500 hover:text-white', 'text-slate-500 hover:text-slate-800')
content = content.replace('bg-gray-950 border border-gray-700', 'bg-gray-50 border border-gray-200')
content = content.replace('text-green-300', 'text-slate-700')
content = content.replace('bg-gray-700 hover:bg-gray-600 text-white', 'bg-gray-100 hover:bg-gray-200 text-slate-700 border border-gray-200')
content = content.replace('bg-gray-800 border border-gray-600 text-white', 'bg-white border border-gray-200 text-slate-800')

# Main Header
content = content.replace('bg-gradient-to-r from-gray-900 via-cyan-950/40 to-gray-900 border border-cyan-500/20', 'bg-white shadow-sm border border-black/5')
content = content.replace('text-2xl font-bold text-white', 'text-2xl font-bold text-slate-800')

# Stats
content = content.replace('bg-gradient-to-br from-gray-900 to-emerald-950/30 border border-emerald-500/20', 'bg-white border border-black/5 shadow-sm')
content = content.replace('bg-gradient-to-br from-gray-900 to-gray-800/50 border border-gray-700', 'bg-white border border-black/5 shadow-sm')
content = content.replace('bg-gradient-to-br from-gray-900 to-cyan-950/30 border border-cyan-500/20', 'bg-white border border-black/5 shadow-sm')
content = content.replace('bg-gradient-to-br from-gray-900 to-purple-950/30 border border-purple-500/20', 'bg-white border border-black/5 shadow-sm')
content = content.replace('text-3xl font-bold text-white', 'text-3xl font-bold text-slate-800')

# Certificate Info
content = content.replace('bg-gray-900 border border-gray-700', 'bg-white border border-black/5 shadow-sm')

# List items
content = content.replace('border-dashed border-gray-700 bg-gray-900/50', 'border-dashed border-gray-200 bg-white/50')
content = content.replace('bg-gray-900 border', 'bg-white border')
content = content.replace('border-gray-700', 'border-gray-200')
content = content.replace('border-gray-800', 'border-gray-100')
content = content.replace('bg-gray-950 rounded', 'bg-gray-50 rounded border border-gray-200')

with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)

print("SstpProvisioning.tsx updated")
