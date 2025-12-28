#!/usr/bin/env python3
"""
Script to remove specific cards from the timing page.
"""

import re

def remove_optimization_result_section(content):
    """Remove the Optimization Result section."""
    # Pattern to match from the comment to the end of the right column
    pattern = r'\s*{/\* Right Column: Optimization Results \*/}.*?</div>\s*</div>'
    
    # Use DOTALL flag to match across newlines
    result = re.sub(pattern, '', content, flags=re.DOTALL)
    return result

def remove_forecast_bands_section(content):
    """Remove the Forecast Bands section."""
    # Pattern to match the entire Forecast Bands card
    pattern = r'\s*{/\* Unified Forecast Bands Card - Full Width \*/}.*?</div>\s*</div>'
    
    # Use DOTALL flag to match across newlines
    result = re.sub(pattern, '', content, flags=re.DOTALL)
    return result

def main():
    file_path = 'app/company/[ticker]/timing/page.tsx'
    
    # Read the file
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    print(f"Original file size: {len(content)} characters")
    
    # Remove sections
    content = remove_optimization_result_section(content)
    print(f"After removing optimization result: {len(content)} characters")
    
    content = remove_forecast_bands_section(content)
    print(f"After removing forecast bands: {len(content)} characters")
    
    # Write back to file
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)
    
    print("Successfully removed both sections!")

if __name__ == '__main__':
    main()