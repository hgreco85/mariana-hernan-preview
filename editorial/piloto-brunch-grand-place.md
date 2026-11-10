# Nueva experiencia piloto — Brunch junto a la Grand-Place

**Estado:** PROPUESTA APROBADA PARA PREPARAR; NO PUBLICAR NI COBRAR TODAVÍA.

## Decisión del usuario (2026-11-10)
- Crear una experiencia **nueva**, basada editorialmente en la archivada **V09-052**, no reactivar V09-052.
- **Nuevo ID provisional:** V09-081 (verificar que esté libre en la hoja maestra antes de insertarlo).
- **Ciudad:** Bruselas, Bélgica.
- **Categoría:** Gastronomía.
- **Título ES:** Brunch junto a la Grand-Place.
- **Título PT-BR:** Brunch perto da Grand-Place.
- **Descripción ES:** Un comienzo de día tranquilo para compartir café, panadería y algo rico cerca de la histórica Grand-Place de Bruselas.
- **Descrição PT-BR:** Um começo de dia tranquilo para compartilhar café, pães e algo gostoso perto da histórica Grand-Place de Bruxelas.
- **Precio del regalo:** ARS 10.000 (importe simbólico del piloto, NO precio verificado de un establecimiento).
- **Estado editorial inicial:** Propuesta para publicar.
- **Estado del regalo inicial:** Disponible, **nunca Regalada/Cobrada antes de la confirmación real**.
- **Posición deseada:** tercera o cuarta tarjeta del catálogo visible (el orden es presentación, no nuevo precio para otra experiencia).
- **Lugar de referencia:** entorno de Grand-Place, Bruselas (cafetería concreta no seleccionada).
- **Foto:** escoger imagen legítima con licencia/procedencia verificable; no usar una foto genérica como prueba de proveedor específico.
- **Origen editorial:** V09-052, archivada, con precio anterior ARS 78.000. **Conservar V09-052 archivada sin tocar**.

## Invariantes
1. Mantener idénticas las 62 experiencias publicadas existentes (IDs, títulos, precios, imágenes, estados).
2. Mantener archivadas las 18 propuestas anteriores, incluida V09-052.
3. **No** introducir la V09-081 en Google Sheets ni desplegarla hasta finalizar una revisión integral y el pase a producción autorizado; todo este archivo es preparación editorial.
4. Cuando se autorice publicación, crear entrada adicional en el backend canónico con ID único, aumentando el catálogo visible a **63** (62 originales + nueva), verificar ES/PT, filtros, orden de tarjetas, imágenes y disponibilidad en Firebase y GitHub Pages.
5. Solo permitir compra LIVE tras auditoría de acreditación, beneficiario real confirmado, secretos de producción aislados, controles fail-closed y autorización expresa del pase a LIVE. El usuario ratificó titularidad de `GRECOHERNAN` (ID 84725274), pero **no autorizó activar LIVE ni ejecutar una compra real**.
6. No crear órdenes ni modificar hojas de operaciones para simular regalos; una vez que el pago auténtico esté acreditado, actualizar **solamente la nueva experiencia** a Regalada y cobrada.
7. Mantener `LIVE_MODE=false` y `PAYMENTS_ENABLED=false` hasta autorización separada; sin gastos incrementales ni Railway.

## Referencias
- Seguimiento preparación LIVE: https://github.com/hgreco85/HG-Market-System/issues/2382
- Validación previa TEST: https://github.com/hgreco85/HG-Market-System/issues/2322
- Fuente editorial canónica: Google Sheet «Catálogo circuito v0.9», fila V09-052.
