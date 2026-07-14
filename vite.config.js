import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import fs from 'fs'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(), 
    viteSingleFile(),
    {
      name: 'post-process-and-copy-to-root',
      closeBundle() {
        const src = path.resolve('dist/index.html');
        const dest = path.resolve('報價單對帳工具.html');
        
        try {
          if (!fs.existsSync(src)) {
            console.error('Error: dist/index.html does not exist!');
            return;
          }
          
          let html = fs.readFileSync(src, 'utf8');
          console.log(`Post-processing HTML in closeBundle hook. Original size: ${html.length} bytes`);
          
          // 1. Strip type="module" and crossorigin attributes
          html = html
            .replace(/type="module" crossorigin/g, '')
            .replace(/type="module"/g, '');
          
          // 2. Find all script tags and locate the main bundled script (length > 5000)
          const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
          let match;
          const scriptsToMove = [];
          
          while ((match = scriptRegex.exec(html)) !== null) {
            const tagContent = match[0];
            const innerContent = match[1];
            // Only move the bundle script (large payload)
            if (innerContent.length > 5000) {
              scriptsToMove.push(tagContent);
            }
          }
          
          console.log(`Found ${scriptsToMove.length} large script tags to move.`);
          
          // 3. Move the bundle script(s) to the end of the body
          // Use a function as replacement to prevent '$' character escaping issues
          scriptsToMove.forEach(tag => {
            html = html.replace(tag, '');
            html = html.replace('</body>', () => `${tag}</body>`);
          });
          
          // 4. Save the modified HTML back to dist/index.html
          fs.writeFileSync(src, html, 'utf8');
          console.log('Saved post-processed HTML to dist/index.html');
          
          // 5. Copy the finished HTML bundle to root as 報價單對帳工具.html
          fs.copyFileSync(src, dest);
          console.log('Successfully copied single-file HTML bundle to root: 報價單對帳工具.html');
          
        } catch (e) {
          console.error('Error in post-processing closeBundle hook:', e.message);
        }
      }
    }
  ],
})
