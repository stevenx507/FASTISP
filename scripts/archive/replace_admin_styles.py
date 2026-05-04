import os
import re

files_to_process = [
    'src/components/admin/RemoteNatPanel.tsx',
    'src/components/admin/NetworkNodesMap.tsx',
    'src/components/admin/DebtQuery.tsx',
    'src/components/admin/BandwidthReusePanel.tsx'
]

replacements = [
    (r'text-white dark:text-white', 'text-slate-800'),
    (r'dark:bg-gray-[0-9]+', ''),
    (r'dark:text-white', ''),
    (r'dark:text-gray-[0-9]+', ''),
    (r'dark:text-slate-[0-9]+', ''),
    (r'dark:border-gray-[0-9]+', ''),
    (r'dark:border-blue-[0-9]+', ''),
    (r'dark:bg-blue-[0-9]+/[0-9]+', ''),
    (r'dark:hover:bg-[a-z]+-[0-9]+/[0-9]+', ''),
    (r'bg-white/5 backdrop-blur-md', 'bg-white shadow-sm'),
    (r'bg-white/15', 'bg-gray-100 hover:bg-gray-200'),
    (r'text-slate-300', 'text-slate-700'),
    (r'border-white/5', 'border-gray-200'),
    (r'border-white/10', 'border-gray-100'),
    (r'bg-blue-500/10', 'bg-blue-50'),
    (r'border border-blue-100', 'border border-blue-200'),
    (r'text-blue-300', 'text-blue-800'),
    (r'bg-blue-500/20', 'bg-blue-100 text-blue-800'),
    (r'text-slate-400', 'text-slate-500'),
    (r'bg-white/10', 'bg-gray-100'),
    (r'bg-amber-500/20 text-amber-400', 'bg-amber-100 text-amber-800'),
    (r'text-blue-600 hover:bg-blue-500/10', 'text-blue-600 hover:bg-blue-50'),
    (r'text-yellow-600 hover:bg-amber-500/10', 'text-amber-600 hover:bg-amber-50'),
    (r'text-red-600 hover:bg-rose-500/10', 'text-red-600 hover:bg-red-50'),
    (r'bg-rose-500/10 text-red-600', 'bg-red-50 text-red-700'),
    (r'bg-emerald-500/20 text-emerald-400', 'bg-emerald-100 text-emerald-800'),
    (r'bg-rose-500/20 text-rose-400', 'bg-rose-100 text-rose-800'),
    (r'bg-white/5', 'bg-white'),
    (r'  +', ' ') # Normalize multiple spaces that might result from replacing with empty string
]

for rel_path in files_to_process:
    file_path = os.path.join("frontend", rel_path)
    if not os.path.exists(file_path):
        print(f"File not found: {file_path}")
        continue
        
    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()
        
    for pattern, repl in replacements:
        content = re.sub(pattern, repl, content)
        
    # Fix potential double spaces in className strings
    content = re.sub(r' +className="', ' className="', content)
    content = re.sub(r'classNames?=" +', 'className="', content)
    content = re.sub(r' +"', '"', content)
    
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(content)
        
    print(f"{rel_path} updated")
