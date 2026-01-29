/**
 * Generate PNG icons from SVG
 * Run: npm install sharp && node generate-icons.js
 */

const fs = require('fs');
const path = require('path');

// Try to use sharp if available
async function generateWithSharp() {
  try {
    const sharp = require('sharp');
    const svgPath = path.join(__dirname, 'icon.svg');
    const svg = fs.readFileSync(svgPath);

    const sizes = [16, 48, 128];

    for (const size of sizes) {
      await sharp(svg)
        .resize(size, size)
        .png()
        .toFile(path.join(__dirname, `icon${size}.png`));
      console.log(`Created icon${size}.png`);
    }

    console.log('Done! Icons generated successfully.');
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') {
      console.log('Sharp not installed. Creating placeholder icons...');
      createPlaceholderIcons();
    } else {
      throw error;
    }
  }
}

// Create simple placeholder icons (valid PNG files)
function createPlaceholderIcons() {
  // Minimal valid PNG (1x1 purple pixel, will be stretched by Chrome)
  // This is a base64-encoded 1x1 PNG
  const sizes = [16, 48, 128];

  // Simple purple gradient PNG placeholder (base64)
  const placeholderBase64 = {
    16: 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAP0lEQVQ4T2NkoBAwUqifgWoGjBowagADAwMjNQMRPBapbgAjNeMBag4DqoWBMAwYqG4ANcOQ4mREdUdSMwwArhQGEfa4tPsAAAAASUVORK5CYII=',
    48: 'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAfElEQVRoQ+3WMQoAIAwD0Or9D627OIoIgmBGl/4OHaRJaVVVdXPu57n5fq4/BkAAGxjAnQBAmAAAAAAAAAAAAGjAB8A5wBkAAAAAAADQgCcAZwAAAAAAAEADHgGcAQAAAAAAAA14A+AM4J8DvgJ+gPODAAAAAHYBemUCMcBhjyMAAAAASUVORK5CYII=',
    128: 'iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAAnElEQVR4nO3BMQEAAADCoPVP7W0HoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4NcAv/QAAeWJLSsAAAAASUVORK5CYII='
  };

  for (const size of sizes) {
    const buffer = Buffer.from(placeholderBase64[size], 'base64');
    fs.writeFileSync(path.join(__dirname, `icon${size}.png`), buffer);
    console.log(`Created placeholder icon${size}.png`);
  }

  console.log('');
  console.log('Note: These are placeholder icons.');
  console.log('For proper icons, install sharp: npm install sharp');
  console.log('Then run this script again.');
}

generateWithSharp().catch(console.error);
