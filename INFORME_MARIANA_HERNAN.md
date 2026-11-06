# Mariana & Hernán — Integración Mercado Pago y revisión de fotografías

## 1. Respaldo

- Proyecto original clonado en `mp-work-backup` (Apps Script ID `1DKxGwetYDO5a7C73vbMrELFq13C4D4OZ-xKKrsL_40SMFx84q5Dxgmoi`).
- Implementación pública original (`@5 - 1.2 final`) no se modificó; se crearon deployments de prueba separados.

## 2. Implementación de prueba

- Apps Script (frontend + hojas): deployment de prueba `@12`
  - URL: https://script.google.com/macros/s/AKfycbxGq-PTuyWeY5VpaBnAA3gI62BpnsduL6HXNE5bylnVFGHRQovhO-Oc1sifJ2wN5EcJ/exec
- Backend mínimo (Cloudflare Worker): https://mp-webhook.paper-molasses.workers.dev
- Cuenta temporal Cloudflare (reclamar o recrear): https://dash.cloudflare.com/claim-preview?claimToken=pHn7yOJbOd-wi-DizUpxf3nRIiR7gyjz8g9x0Gzs0Do
  - Motivo: Apps Script no expone las cabeceras `x-signature` / `x-request-id` necesarias para validar la firma del Webhook de Mercado Pago. El Worker valida la firma HMAC-SHA256 y reenvía el evento a Apps Script.

## 3. Flujo implementado

1. El invitado elige una experiencia y pulsa «Regalar esta experiencia».
2. `reserveExperience` (servidor Apps Script) valida disponibilidad con `LockService`, reserva temporalmente (15 min configurables) y crea la orden interna en la hoja `Operaciones`.
3. El navegador llama al Worker `/api/create-order`, que verifica la reserva y crea la orden en Mercado Pago (Orders API, Checkout Pro).
4. Redirección a `checkout_url` de Mercado Pago.
5. Retorno a la web con `mp_status` y `order`; se consulta el estado real al servidor.
6. Webhook de Mercado Pago → Worker (validación de firma) → Apps Script `confirmPayment` → actualiza estado y marca la experiencia como regalada solo si el pago está `approved`.

## 4. Monedas

- Cuenta argentina: cobro definitivo en **ARS**.
- USD y BRL se muestran como referencia orientativa.
- El importe se calcula en el servidor (`ARS_PER_USD`, por defecto 1560) y se fija al crear la orden.
- Se muestra aviso: el banco emisor puede aplicar su propia conversión y cargos.

## 5. Estados de disponibilidad

Disponible, Reservada temporalmente, Pago pendiente, Regalada y cobrada, Rechazada/Cancelada, Reembolsada o en revisión.  
La reserva se libera solo si no existe un pago pendiente que pueda acreditarse después.

## 6. Página de experiencia regalada

- Conserva foto, ciudad, categoría, título, descripción y lugar.
- Oculta precios y botón.
- Muestra «Este recuerdo ya tiene quien lo haga posible. ❤️» y el texto complementario en ES y PT-BR.
- Los pagos pendientes muestran estado de espera, no el corazón.

## 7. Fotografías (80)

- Columna P de `Catálogo circuito v0.9` completada con 80 URLs estables (Unsplash + Wikimedia Commons).
- Nueva hoja `Fuentes fotos` con fuente, atribución y licencia.
- Casos específicos corregidos: Residenz de Múnich (interior), Sachertorte (foto de café), Coliseo, Belgian Beer World, tren nocturno, etc.
- Se eliminaron duplicados: las 80 experiencias tienen ahora imágenes distintas y más acordes a cada experiencia.
- El mapa del viaje se reemplazó por un SVG con el circuito real: Roma → Múnich → Estrasburgo → París → Bruselas → Praga → Viena → Roma.

## 8. Credenciales (cargar de forma segura)

No pegar tokens en el chat. Cargar en:

**Apps Script → Configuración del proyecto → Propiedades del script:**
- `MP_ACCESS_TOKEN` = Access Token de Mercado Pago (prueba o producción).
- `BACKEND_SHARED_SECRET` = secreto compartido con el Worker.
- `WORKER_WEBHOOK_URL` = URL del Worker.
- `ARS_PER_USD` = cotización usada (ej. 1560).
- `RESERVATION_MINUTES` = minutos de reserva (ej. 15).

**Worker (Cloudflare):**
- `wrangler secret put MP_ACCESS_TOKEN`
- `wrangler secret put MP_WEBHOOK_SECRET`
- Variables en `wrangler.toml`: `APPS_SCRIPT_URL`, `APP_URL`, `SHARED_SECRET`, `WORKER_WEBHOOK_URL`.

## 9. Pruebas realizadas vs simuladas

Realizadas (estructura/flujo):
- Carga de catálogo de 80 experiencias con fotos.
- Render móvil y cambio de idioma.
- Reserva atómica y liberación forzada.
- Validación de firma del Worker (código).
- Flujo reserva → Worker → error controlado por falta de token.

Simuladas / pendientes (requieren credenciales MP):
- Pago aprobado, pendiente, rechazado, cancelado.
- Webhook real y duplicado/retrasado.
- Tarjeta internacional.
- Reembolso/contracargo.

## 10. Lo que falta para producción

1. Cargar `MP_ACCESS_TOKEN` real y `MP_WEBHOOK_SECRET` real.
2. Configurar la URL del Worker en el panel de Mercado Pago como notification URL (o dejar `notification_url` por orden).
3. Realizar pruebas sandbox completas (aprobado, pendiente, rechazado, cancelado, webhook duplicado/retrasado, reembolso).
4. Aprobación explícita del operador para habilitar producción.
5. Mover el Worker a una cuenta Cloudflare propia (no temporal) y configurar secretos definitivos.
6. Rotar `BACKEND_SHARED_SECRET` si se usó el valor de prueba.

No se declara la integración completa hasta contar con Webhooks verificados, pruebas y credenciales.
