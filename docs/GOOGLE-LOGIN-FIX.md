# Fix Google Login "Navigateur non sécurisé"

## Problème

Google bloque avec "Impossible de vous connecter - Ce navigateur ou cette application ne sont peut-être pas sécurisés."

## Cause

Google détecte:
- Profil Chrome vide (pas d'historique)
- Pas d'extensions
- Fingerprint suspect
- Comportement automatisé

## Solution 1: Copier votre vrai profil Chrome

### Trouver votre profil Chrome:

**Windows:**
```
C:\Users\<USERNAME>\AppData\Local\Google\Chrome\User Data\Default
```

**Mac:**
```
~/Library/Application Support/Google/Chrome/Default
```

**Linux:**
```
~/.config/google-chrome/Default
```

### Copier vers HydraSpecter:

```bash
# Windows (PowerShell)
$chromeProfile = "$env:LOCALAPPDATA\Google\Chrome\User Data\Default"
$hydraProfile = "$env:USERPROFILE\.hydraspecter\profiles\pool-0"

# IMPORTANT: Fermer Chrome avant de copier!
Copy-Item -Path $chromeProfile -Destination $hydraProfile -Recurse -Force

# Mac/Linux
cp -r ~/Library/Application\ Support/Google/Chrome/Default ~/.hydraspecter/profiles/pool-0
```

### ⚠️ IMPORTANT:
1. **Fermez Chrome complètement** avant de copier
2. Cela va remplacer le profil pool-0
3. Vos sessions Google seront disponibles dans HydraSpecter
4. **Risque de sécurité**: Ne faites ça que sur votre machine personnelle!

## Solution 2: Pointer vers votre profil Chrome directement

Modifiez `src/global-profile.ts` pour utiliser votre vrai profil:

```typescript
// Ligne ~72
const realChromeProfile = path.join(
  os.homedir(),
  'AppData', 'Local', 'Google', 'Chrome', 'User Data', 'Default'
);

this.profileDir = realChromeProfile; // Au lieu du pool
```

**⚠️ Attention**: Chrome doit être fermé!

## Solution 3: Accepter les risques et utiliser quand même

Pour certains cas d'usage, vous pouvez:
1. Vous connecter manuellement une fois dans le browser visible
2. La session sera sauvegardée dans le profil pool
3. Réutilisée aux prochains lancements

## Test

Après avoir copié votre profil:

```bash
node test-google.js
```

Vous devriez être déjà connecté à Google!
