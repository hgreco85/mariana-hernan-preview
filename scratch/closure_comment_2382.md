## CIERRE TÉCNICO DE PREPARACIÓN PRODUCTIVA (P0) — EVIDENCIAS VERIFICABLES

En cumplimiento estricto del comentario [#6775643716](https://github.com/hgreco85/HG-Market-System/issues/2382#issuecomment-6775643716) y las directivas de seguridad sin activación de cobros:

### 1. Verificación de PR #28 y Ejecución Completa de la Suite de Tests
- **Commit fusionado en `main`:** [`4314c7a97c30e08e93d6c8baeb14af19e95ede2f`](https://github.com/hgreco85/mariana-hernan-preview/commit/4314c7a97c30e08e93d6c8baeb14af19e95ede2f).
- **Corrección fail-closed de `resolveOrderStatus`:**
  - Se exige estrictamente evidencia positiva de pago acreditado (`p.status === 'approved'` o `p.status === 'processed' && p.status_detail === 'accredited'`) con Payment ID verificado.
  - Órdenes sin pago acreditado, expiradas, rechazadas o con pagos incompletos resuelven como `cancelled`, `rejected` o `pending`. Jamás como `approved`.
- **Ejecución de la suite (`npm test --prefix worker`):**
  - **84 de 84 tests PASS (0 fallos)**, duración ~30.8s.
  - Incluye los 3 tests de regresión productivos para `processed` sin `status_detail` y órdenes sin transacciones.
  - Validación completa de integridad del catálogo (62 experiencias activas, unicidad de IDs, escalonamiento ARS, fotos HTTPS) y concurrencia atómica con LockService en Google Sheets.

### 2. Despliegue y Verificación Segura en Staging (Cloudflare Worker)
- **Versión activa en staging:** `afef91b0-ff5e-4d07-b7c1-c5913cb78791` (desplegada en `mp-webhook`).
- **Verificación de endpoint en vivo (`/health`):**
  ```json
  {"status":"ok","service":"wedding-mp-backend","mode":"staging_test","apiMode":"orders","timestamp":"2026-11-10T18:34:58.164Z"}
  ```
- **Aislamiento de producción:** `worker/wrangler.toml` cuenta con entorno segregado `[env.production]` (`mp-webhook-production`) listo para recibir credenciales LIVE independientes cuando se autorice. `LIVE_MODE=false` y `PAYMENTS_ENABLED=false` se mantienen inalterados.

### 3. Auditoría de Derechos y Validación de Foto para V09-081
- **Foto provisional heredada (descartada):** La URL referencial de `V09-052` (`photo-1570905668667-03183c134d04`) fue auditada visualmente mediante descarga e inspección de imagen: mostraba una embarcación en los canales de Ámsterdam (Países Bajos), totalmente discordante con un brunch en Bruselas.
- **Foto definitiva validada:**
  - **Fuente:** `File:2005-09-05 La Brouette Grand-Place Brussels.jpg` en Wikimedia Commons.
  - **Contenido visual:** Terraza exterior de café con mesas, sombrillas y camarero sobre los adoquines históricos de la Grand-Place de Bruselas, frente a las casas gremiales.
  - **Licencia:** Creative Commons Attribution-Share Alike 2.5 (`CC BY-SA 2.5`), verificada vía API de Wikimedia Commons (uso comercial/no comercial permitido con atribución).
  - **URL canónica:** `https://upload.wikimedia.org/wikipedia/commons/thumb/a/a3/2005-09-05_La_Brouette_Grand-Place_Brussels.jpg/960px-2005-09-05_La_Brouette_Grand-Place_Brussels.jpg` (HTTP 200, JPEG 960px).

### 4. Preparación de la Publicación de V09-081 y Paridad de Dominios
- **Google Sheets canónico:**
  - Fila `A82:S82` registrada: `V09-081`, *Brunch junto a la Grand-Place*, Bruselas, ARS 10.000, `Estado editorial=Propuesta`, `Disponibilidad demo=No mostrar`.
  - Invariantes preservadas: 62 experiencias visibles originales intactas, 18 archivadas intactas (incluida `V09-052`). Total 81 entradas.
- **Vista previa de 63 tarjetas (`preview.html`):**
  - Desplegada con paridad verificada en ambos dominios:
    - **Firebase Hosting:** `https://marianayhernan.web.app/preview.html`
    - **GitHub Pages:** `https://regalos.hgstack.com/preview.html`
  - **Posicionamiento:** `V09-081` se ubica como la **4ª tarjeta** del recorrido (inmediatamente después de `V09-001`, `V09-003` y `V09-004`).
  - **Estado:** Modo vista previa estática con pagos deshabilitados.
- **Página principal pública (`index.html`):** Se mantiene estrictamente con las 62 experiencias originales publicadas en ambos dominios (`https://marianayhernan.web.app/` y `https://regalos.hgstack.com/`), garantizando cero exposición pública de la propuesta hasta la autorización de pase a producción.
- **PR Draft #27:** Actualizada con el reporte de auditoría de foto y posicionamiento (commit [`691923e`](https://github.com/hgreco85/mariana-hernan-preview/commit/691923e)).

### 5. Estado del Bloqueo Productivo (PAID_RUN_FREEZE)
- Cero cobros reales y cero gastos ejecutados ($0 incremental, NO Railway).
- `LIVE_MODE=false` y `PAYMENTS_ENABLED=false` activos en staging y producción.
- Titularidad ratificada previamente: `GRECOHERNAN` (User ID `84725274`).
- **Paso humano imprescindible previo a cualquier cobro real:** Autorización expresa del usuario para promover `V09-081` a visible e ingresar la credencial LIVE en el entorno segregado `mp-webhook-production`.
