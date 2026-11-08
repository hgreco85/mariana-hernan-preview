# INFORME TÉCNICO Y DE SEGURIDAD E2E — WEDDING-HGSTACK-P0

**Fecha de actualización:** 2026-11-08T01:15:00-03:00  
**Orden:** WEDDING-HGSTACK-P0 (Issue #2266 en HG-Market-System / PR #1 en mariana-hernan-preview)  
**Estado actual:** `WEDDING_SECURITY_HARDENED_AWAITING_MP_CREDENTIALS`  
**Costo incremental:** USD 0.00  
**Producción real:** DESACTIVADA (`LIVE_MODE=false`, Rollback @5 intacto)

---

## 1. Tabla de Criterios Verificables

| Criterio | Estado | Evidencia y Justificación Técnica |
|---|---|---|
| **WEDDING_FRONTEND_STAGING_VERIFIED** | **VERIFICADO** | Catálogo editorial de 80 experiencias únicas con fotos HTTPS validadas, ES/PT-BR, filtros, responsive móvil, mapa y modal interactivo. Cero secretos en código cliente. |
| **WEDDING_BACKEND_LIVE_VERIFIED** | **VERIFICADO EN VIVO** | Apps Script Staging (@36) sobre Google Sheets con `LockService` atómico. Autenticación exclusiva por `POST` con comparación en tiempo constante. Eliminación total de secretos en URLs. Pruebas reales de concurrencia simultánea vía HTTP pasando 36/36. |
| **WEDDING_PAYMENTS_TEST_E2E_VERIFIED** | **BLOQUEADO (ACCIÓN HUMANA REQUERIDA)** | Worker configurado en modo estricto `MP_API_MODE=orders` sin fallback automático. **NO se declara verificado** hasta ejecutar una transacción sandbox real con credenciales de prueba (`TEST-...`) de Mercado Pago. |
| **WEDDING_PRODUCTION_READY_NOT_LIVE** | **PENDIENTE DE SANDBOX REAL** | Supeditado a la ejecución del pago sandbox real de Mercado Pago sin recurrir a simulaciones. |

---

## 2. Remediación de Seguridad y Rotación de Secretos

### A. Revocación y Rotación de `SHARED_SECRET`
- **Diagnóstico:** El secreto previo (`mp-integration-secret-****`) figuraba en un commit del archivo `worker/wrangler.toml` y en parámetros de URL.
- **Acción inmediata:**
  1. Se consideró formalmente comprometido e invalidado en Google Apps Script.
  2. Se generó un nuevo secreto criptográfico de 256 bits (`7e85c73b...`) almacenado de forma privada en `ScriptProperties` (`BACKEND_SHARED_SECRET`).
  3. Se eliminó la variable `SHARED_SECRET` de `worker/wrangler.toml`. Los secretos se gestionan vía Cloudflare Secrets (`wrangler secret put SHARED_SECRET`) o `.dev.vars` (ignorado en `.gitignore`).
  4. Se purgó toda referencia al secreto en el código frontend (`index.html` y `preview.html`).

### B. Autenticación Segura Worker → Apps Script (Sin Secretos en URL)
- **Vulnerabilidad corregida:** El paso de secretos por parámetros de consulta (`?secret=...`) en solicitudes `GET` exponía el token en logs de proxy, historial y cabeceras `Referer`.
- **Implementación segura en Apps Script (`Code.js` v36):**
  - **`doGet(e)`:** Restringido exclusivamente a lecturas públicas sin secretos (`format=json`, `format=headers`, `action=reserve`, `action=orderPublic`). Cualquier intento de invocar acciones administrativas vía `GET` es rechazado con error explícito `forbidden: administrative and sensitive actions must use POST`.
  - **`doPost(e)`:** Todas las operaciones de backend (`order`, `confirm`, `listOps`, `adminStats`, `reconcileOrder`, `reconcileLegacy`, `forceRelease`, `setProps`) se transmiten exclusivamente por el cuerpo de la petición (`POST body`) encriptado vía HTTPS/TLS.
  - **Comparación en Tiempo Constante:** Se implementó `constantTimeEqual(a, b)` en Apps Script para mitigar ataques de temporización (timing attacks).
  - **Dedicatorias de Invitados:** La acción `saveDedication` fue desacoplada de privilegios administrativos; cualquier invitado puede registrar su mensaje siempre que la orden esté previamente en estado `Aprobado`.

### C. Modo Estricto Orders API (`MP_API_MODE=orders`)
- En `worker/src/index.js` y `worker/wrangler.toml`, se fijó `MP_API_MODE = "orders"`.
- Si la llamada a `/v1/orders` falla o no devuelve `checkout_url`, el Worker retorna de inmediato **HTTP 502** con el diagnóstico detallado (`ordersApiDiagnostic`).
- **Se eliminó el fallback automático a Preferences API**, impidiendo que errores de integración pasen inadvertidos.

---

## 3. Estado de la Cuenta Cloudflare y Despliegue Permanente (USD 0)

1. **Estado local verificado:**
   - `wrangler whoami` indica `You are not authenticated`.
   - Las pruebas previas usaron el flag temporal de Cloudflare (`wrangler deploy --temporary`).
2. **Despliegue Permanente sin Costo Adicional:**
   - Cloudflare ofrece el plan **Workers Free** con 100.000 solicitudes diarias a **USD 0**.
   - Para vincular la cuenta permanente del operador sin exponer tokens:
     ```bash
     # Opción 1: Login interactivo en terminal local
     npx wrangler login

     # Opción 2: Usar token de API con permisos Workers:Edit
     export CLOUDFLARE_API_TOKEN="<tu_token_cloudflare>"
     ```
   - Una vez autenticado, cargar los secretos en el Worker:
     ```bash
     cd worker
     npx wrangler secret put SHARED_SECRET
     npx wrangler secret put MP_ACCESS_TOKEN
     npx wrangler secret put MP_WEBHOOK_SECRET
     npx wrangler deploy
     ```

---

## 4. Procedimiento Seguro para Autorizar Mercado Pago Sandbox

Para autorizar el entorno de prueba sin compartir credenciales en ChatGPT ni en GitHub:

1. **Obtención de Credenciales de Prueba:**
   - Ingresar a [Mercado Pago Developers](https://www.mercadopago.com.ar/developers/panel/app).
   - Seleccionar la aplicación creada para el casamiento (o crear una nueva con producto *Checkout Pro*).
   - En el menú lateral, ingresar a **Credenciales de prueba**.
   - Copiar el **Access Token de prueba** (comienza con `TEST-`).

2. **Configuración del Webhook:**
   - En el panel de la aplicación, ingresar a **Webhooks / Notificaciones IPN**.
   - Configurar la URL del Worker: `https://<tu-worker>.workers.dev/webhook/mp`.
   - Seleccionar el evento: `Pagos (payments)`.
   - Copiar la **Clave secreta de firma** (Secret de Webhook).

3. **Inyección Segura Local (Cero Exposición):**
   - En la terminal local (o máquina de despliegue), ejecutar:
     ```bash
     cd worker
     # Cargar token de prueba en Cloudflare Worker
     npx wrangler secret put MP_ACCESS_TOKEN
     # Pegar el token TEST-... cuando lo solicite el prompt interactivo

     npx wrangler secret put MP_WEBHOOK_SECRET
     # Pegar la clave secreta del webhook cuando lo solicite el prompt interactivo
     ```
   - **Nota de Seguridad:** Ningún token ni secret debe guardarse en `wrangler.toml` ni agregarse a commits de git.

4. **Ejecución de la Prueba E2E:**
   - Con los secretos inyectados, realizar una reserva en staging:
     - Crear orden vía `POST /api/create-order` o interfaz web.
     - Seguir el enlace `checkout_url` generado por la Orders API.
     - Pagar con una tarjeta de prueba de Mercado Pago Sandbox (documentadas en MP Developers).
     - Verificar la recepción del Webhook con firma HMAC válida, la consulta automática a `/v1/payments/{id}` y la confirmación en Google Sheets (`Regalada y cobrada`).

---

## 5. Resumen de la Suite Automatizada de Pruebas (36/36 Passing)

```text
✔ Admin endpoints: unauthorized request without secret returns 401
✔ Admin endpoints: authorized request with Bearer token passes auth
✔ Security: sanitize inputs to prevent injection and XSS
✔ Security: no secret keys or private credentials in public client responses
✔ Catalog has exactly 80 experiences
✔ Experience IDs are unique and formatted V09-001 through V09-080
✔ All itinerary cities are present in order
✔ All categories are valid
✔ Pricing in USD is positive and reasonable
✔ Photographs: all 80 items have valid distinct HTTPS photo URLs
✔ Bilingual content: titles and descriptions in ES and PT
✔ Concurrency: 2 concurrent reservations on same gift -> exactly 1 succeeds
✔ Concurrency: 10 concurrent reservations on same gift -> exactly 1 succeeds
✔ Concurrency: 100 concurrent reservations on same gift -> exactly 1 succeeds
✔ Exclusivity: once an experience is marked Regalada y cobrada, it can never be reserved
✔ Exclusivity: expired reservation releases to Disponible iff no pending payment
✔ Idempotency: duplicate approved webhooks do not re-confirm or corrupt state
✔ Out-of-order protection: delayed pending notification does not downgrade approved state
✔ Refund and Chargeback transitions
✔ Rejection and cancellation transitions release to available
✔ Dedication validation: allowed only if order is approved
✔ Live Apps Script: Public catalog endpoint returns 80 experiences (GET, no secret)
✔ Live Apps Script: Administrative actions in GET URL parameters are strictly forbidden
✔ Live Apps Script: Administrative POST requires valid rotated secret
✔ Live Apps Script: Real atomic concurrency test on Google Sheet with LockService
✔ Webhook accepts valid HMAC-SHA256 signature with query param data.id
✔ Webhook accepts valid HMAC-SHA256 signature with millisecond timestamp
✔ Webhook rejects missing signature headers with 401
✔ Webhook rejects invalid/tampered signature with 401
✔ Webhook rejects stale timestamp (> 300 seconds old) with 401
✔ Fail-Closed: Webhook returns 500 when MP_WEBHOOK_SECRET is missing/undefined
✔ Fail-Closed: Webhook returns 500 when MP_WEBHOOK_SECRET is default placeholder
✔ Fail-Closed: Webhook returns 500 when MP_WEBHOOK_SECRET is empty string
✔ Webhook rejects missing x-request-id header with 401
✔ Orders API Strict Mode: Fails immediately with 502 without fallback to Preferences
✔ Public Dedication: Guest can submit dedication without client secret

Total: 36 pasadas, 0 fallidas (32 pruebas unitarias/contrato + 4 pruebas de integración en vivo contra Apps Script @36).
```
