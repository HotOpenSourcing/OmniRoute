import { readFileSync, writeFileSync } from 'fs';

console.log('🔍 Analyse du fichier credentials.json...\n');

const credPath = 'C:\\Users\\amine\\.zcode\\v2\\credentials.json';
const buffer = readFileSync(credPath);

// Le fichier commence par 0xFE (BOM UTF-16 LE)
// Lire comme UTF-16 LE
const content = buffer.toString('utf16le');

console.log('📄 Contenu décodé:');
console.log(content);
console.log('');

// Parser le JSON
try {
  // Retirer le BOM si présent
  const jsonStr = content.replace(/^\uFEFF/, '');
  const json = JSON.parse(jsonStr);
  
  console.log('📊 Structure du fichier:');
  console.log('Clés:', Object.keys(json));
  console.log('');
  
  // Sauvegarder une version lisible (avec secrets masqués)
  const sanitized = JSON.parse(JSON.stringify(json));
  
  // Masquer les secrets
  for (const key in sanitized) {
    if (typeof sanitized[key] === 'string') {
      if (key.includes('token') || key.includes('Token') || 
          key.includes('secret') || key.includes('Secret') ||
          key.includes('password') || key.includes('Password')) {
        const original = sanitized[key];
        sanitized[key] = `[REDACTED ${original.length} chars]`;
      }
    }
  }
  
  writeFileSync('zai-credentials-structure.json', JSON.stringify(sanitized, null, 2));
  console.log('✅ Structure sauvegardée dans zai-credentials-structure.json');
  console.log('');
  
  // Analyser le contenu OAuth
  const oauthKeys = Object.keys(json).filter(k => 
    k.includes('oauth') || k.includes('OAuth') || 
    k.includes('zai') || k.includes('zcode')
  );
  
  if (oauthKeys.length > 0) {
    console.log('🔑 Clés OAuth trouvées:');
    oauthKeys.forEach(key => {
      const value = json[key];
      console.log(`  ${key}: ${typeof value}`);
      if (typeof value === 'string' && value.length > 0) {
        console.log(`    Longueur: ${value.length} caractères`);
        console.log(`    Début: ${value.substring(0, 20)}...`);
      }
    });
  }
  
} catch (err) {
  console.error('❌ Erreur de parsing JSON:', err.message);
}
