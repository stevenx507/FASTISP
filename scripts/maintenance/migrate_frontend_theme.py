import os
import re

def migrate_theme():
    search_dir = "frontend/src"
    
    replacements = {
        r'bg-slate-900/90': 'bg-white/95',
        r'bg-slate-900/70': 'bg-white/90',
        r'bg-slate-900/60': 'bg-white/80',
        r'bg-slate-900/50': 'bg-gray-100',
        r'bg-slate-900/40': 'bg-gray-100',
        r'bg-slate-900/80': 'bg-white/90',
        r'bg-slate-900': 'bg-white',
        r'bg-slate-800/50': 'bg-gray-50',
        r'bg-slate-800': 'bg-gray-50',
        r'bg-slate-700': 'bg-gray-100',
        r'bg-white/5\b': 'bg-white',
        r'text-slate-50\b': 'text-slate-800',
        r'text-slate-100\b': 'text-slate-800',
        r'text-slate-200\b': 'text-slate-700',
        r'text-slate-300\b': 'text-slate-600',
        r'text-slate-400\b': 'text-slate-500',
        r'border-white/10': 'border-gray-200',
        r'border-slate-800': 'border-gray-200',
        r'border-slate-700': 'border-gray-200',
    }
    
    files_changed = 0
    
    for root, dirs, files in os.walk(search_dir):
        for file in files:
            if file.endswith('.tsx') or file.endswith('.ts') or file.endswith('.jsx'):
                filepath = os.path.join(root, file)
                
                with open(filepath, 'r', encoding='utf-8') as f:
                    content = f.read()
                    
                has_changes = False
                new_content = content
                
                for pattern, repl in replacements.items():
                    if re.search(pattern, new_content):
                        new_content = re.sub(pattern, repl, new_content)
                        has_changes = True
                        
                if has_changes:
                    with open(filepath, 'w', encoding='utf-8') as f:
                        f.write(new_content)
                    print(f"Updated {filepath}")
                    files_changed += 1

    print(f"Theme migration complete. Updated {files_changed} files.")

if __name__ == '__main__':
    migrate_theme()
