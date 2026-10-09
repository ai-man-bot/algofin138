# PWA Icons Directory

## Required Icons

For a complete PWA experience, you need to generate PNG icons in the following sizes:

### Required Sizes:
- `icon-72x72.png` - Small devices
- `icon-96x96.png` - Standard mobile
- `icon-128x128.png` - Medium mobile
- `icon-144x144.png` - High-res mobile
- `icon-152x152.png` - iOS devices
- `icon-192x192.png` - **Standard PWA icon** (required)
- `icon-384x384.png` - High resolution
- `icon-512x512.png` - **High-res PWA icon** (required)

### How to Generate Icons:

1. **Use Online Tools:**
   - https://realfavicongenerator.net/
   - https://www.pwabuilder.com/imageGenerator
   - https://favicon.io/

2. **Upload the provided `icon.svg` file**
   - The SVG contains your brand colors
   - Dark slate background (#0f172a)
   - Electric blue primary (#3b82f6)
   - Trading chart visual elements

3. **Download all sizes** and place them in this `/public/icons/` directory

4. **Replace the SVG with PNGs:**
   - The manifest.json already references the PNG files
   - Just add the PNG files to this folder

### Design Guidelines:

- Use a **512x512px** canvas
- Include 10% padding around the logo
- Use your brand colors:
  - Background: #0f172a (dark slate)
  - Primary: #3b82f6 (electric blue)
  - Accent: #10b981 (emerald) or #f43f5e (rose)
- Make sure the icon is visible on both light and dark backgrounds
- Test on actual devices to ensure clarity

### Apple Touch Icons:

For iOS devices, also create:
- `apple-touch-icon.png` (180x180px)
- Add to `/public/` directory

### Maskable Icons (Optional but Recommended):

Modern Android devices support "maskable" icons that adapt to different shapes:
- Create a version with important elements in the "safe zone" (center 80%)
- Mark as `"purpose": "maskable"` in manifest.json

### Current Status:

✅ SVG template provided (`icon.svg`)
⚠️ PNG icons need to be generated
⚠️ Upload your generated PNGs to this directory

### Quick Start:

```bash
# Using online tool:
1. Visit https://www.pwabuilder.com/imageGenerator
2. Upload /public/icons/icon.svg
3. Download the generated icons package
4. Extract all PNG files to /public/icons/
```

That's it! Your PWA will now have beautiful app icons on all devices.
