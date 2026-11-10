## DIAGNÓSTICO DEFINITIVO: CAUSA RAÍZ DE ERROR EN CHECKOUT TEST

### 1. Evidencia Técnica Irrefutable
Al intentar procesar la orden de prueba con la tarjeta test Visa (`4509 9535 6623 3704`, titular `APRO`), la API de Mercado Pago respondió:
```json
{
  "message": "Unauthorized use of live credentials",
  "error": "unauthorized",
  "status": 401,
  "cause": [{ "code": 7, "description": "Unauthorized use of live credentials" }]
}
```
Y en el Checkout Pro web arrojó la pantalla:
**«Una de las partes con la que intentás hacer el pago es de prueba»**.

### 2. Causa Raíz
- El secret configurado actualmente en Cloudflare Worker (`MP_ACCESS_TOKEN`) es `APP_USR-3994904789163929-...`.
- En la arquitectura de Mercado Pago:
  - Todo token con prefijo **`APP_USR-`** es una **credencial de producción (LIVE)**.
  - El motor de seguridad de Mercado Pago bloquea taxativamente el uso de tarjetas de prueba (`4509...`, `4023...`) o usuarios sandbox en órdenes generadas con un token `APP_USR-` (`Unauthorized use of live credentials` / `Una de las partes es de prueba`).
  - Para que el entorno Sandbox acepte tarjetas de prueba y apruebe transacciones TEST sin dinero real, el `MP_ACCESS_TOKEN` **debe ser el Access Token de prueba**, que obligatoriamente comienza con el prefijo **`TEST-`**.

### 3. Reconciliación Realizada
- La orden fallida `ORD-V09-001-1794325012783` fue conciliada a estado terminal `Cancelado` en Google Sheets (Hoja Operaciones).
- La experiencia `V09-001` fue liberada limpiamente a `Disponible` (catálogo maestro en 62/62 disponibles).

### 4. Acción Requerida para Desbloquear Sandbox E2E
- Obtener el **Access Token de prueba** (`TEST-...`) desde el panel de desarrollador de la aplicación `3994904789163929` en Mercado Pago (pestaña *Credenciales de prueba*).
- Actualizar el secret `MP_ACCESS_TOKEN` en Cloudflare Worker con el token `TEST-...`.
