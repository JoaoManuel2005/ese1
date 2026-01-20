# Validation logic placeholder
# You can add validation scripts here, e.g., chunk validation, schema checks, etc.

def validate_chunks(chunk_dir):
    import os
    import json
    valid = True
    errors = []
    for fname in os.listdir(chunk_dir):
        if not fname.endswith('.txt'):
            continue
        try:
            with open(os.path.join(chunk_dir, fname), 'r', encoding='utf-8') as f:
                data = json.load(f)
                if 'text' not in data or 'metadata' not in data:
                    valid = False
                    errors.append(f"Missing keys in {fname}")
        except Exception as e:
            valid = False
            errors.append(f"Error reading {fname}: {e}")
    return valid, errors

if __name__ == "__main__":
    valid, errors = validate_chunks("../../chunks")
    if valid:
        print("All chunks are valid.")
    else:
        print("Validation errors:")
        for err in errors:
            print(err)
