import os
import re

def migrate_datetime():
    search_dir = "backend"
    
    # regex matches `datetime.utcnow()` and `datetime.utcnow`
    pattern_call = re.compile(r'\bdatetime\.utcnow\(\)')
    pattern_ref = re.compile(r'\bdatetime\.utcnow\b(?!\()')
    
    import_pattern_1 = re.compile(r'^from datetime import .*datetime', re.MULTILINE)
    
    files_changed = 0
    
    # We will use lambda for default=... to avoid passing arguments to now(timezone.utc)
    # default=lambda: datetime.now(timezone.utc)
    
    for root, dirs, files in os.walk(search_dir):
        if 'venv' in root or '__pycache__' in root or '.git' in root:
            continue
            
        for file in files:
            if file.endswith('.py'):
                filepath = os.path.join(root, file)
                
                with open(filepath, 'r', encoding='utf-8') as f:
                    content = f.read()
                    
                has_changes = False
                
                if pattern_call.search(content):
                    content = pattern_call.sub('datetime.now(timezone.utc)', content)
                    has_changes = True
                    
                if pattern_ref.search(content):
                    # Replace references like default=datetime.utcnow with default=lambda: datetime.now(timezone.utc)
                    # We have to be careful if it's already used differently, but in SQLAlchemy default= is the main case.
                    # Let's just do lambda: datetime.now(timezone.utc)
                    content = pattern_ref.sub('lambda: datetime.now(timezone.utc)', content)
                    has_changes = True
                    
                if has_changes:
                    # Ensure timezone is imported
                    if 'timezone' not in content:
                        def add_timezone(match):
                            s = match.group(0)
                            if 'timezone' not in s:
                                return s + ', timezone'
                            return s
                            
                        content, num_subs = import_pattern_1.subn(add_timezone, content)
                        
                        if num_subs == 0:
                            content = 'from datetime import timezone\n' + content
                    
                    with open(filepath, 'w', encoding='utf-8') as f:
                        f.write(content)
                    
                    print(f"Updated {filepath}")
                    files_changed += 1

    print(f"Migration complete. Updated {files_changed} files.")

if __name__ == '__main__':
    migrate_datetime()
