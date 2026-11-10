# Nueva experiencia piloto — Brunch junto a la Grand-Place

**Estado:** REGISTRO CREADO EN SHEETS, OCULTO Y NO COMPRABLE; NO PUBLICADO NI COBRADO.

## Decisión del usuario (2026-11-10)
- Crear una experiencia **nueva**, basada editorialmente en la archivada **V09-052**, no reactivar V09-052.
- **Nuevo ID definitivo:** V09-081; unicidad comprobada y fila agregada al catálogo maestro en **'Catálogo circuito v0.9'!A82:S82**.
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
- **Foto provisional heredada (descartada):** URL referencial de V09-052 (`photo-1570905668667-03183c134d04`) fue auditada visualmente y descartada al comprobar que muestra una embarcación en canales holandeses (Ámsterdam) y no Bruselas ni un café.
- **Foto definitiva validada:** `File:2005-09-05 La Brouette Grand-Place Brussels.jpg` en Wikimedia Commons.
  - **URL:** `https://upload.wikimedia.org/wikipedia/commons/thumb/a/a3/2005-09-05_La_Brouette_Grand-Place_Brussels.jpg/960px-2005-09-05_La_Brouette_Grand-Place_Brussels.jpg`
  - **Contenido:** Terraza exterior de café con mesas, sombrillas y camarero sobre los adoquines de la histórica Grand-Place de Bruselas frente a las casas gremiales.
  - **Licencia y procedencia:** Creative Commons Attribution-Share Alike 2.5 (CC BY-SA 2.5), verificada vía API de Wikimedia Commons (HTTP 200, imagen JPEG 960px, uso comercial y no comercial permitido con atribución).
- **Posicionamiento en catálogo:** 4ª tarjeta del recorrido (`preview.html`), ubicada inmediatamente tras `V09-001`, `V09-003` y `V09-004`, manteniendo sin alterar el orden relativo y contenido de las 62 experiencias activas originales y las 18 archivadas.

## Invariantes
1. Mantener idénticas las 62 experiencias publicadas existentes (IDs, títulos, precios, imágenes, estados).
2. Mantener archivadas las 18 propuestas anteriores, incluida V09-052.
3. **V09-081 ya existe en Google Sheets** con `Estado editorial=Propuesta` y `Disponibilidad demo=No mostrar`, precio `ARS 10000`, sin USD/BRL ficticios. No modificar `No mostrar` ni desplegar la fila como visible sin nuevo gate de publicación y verificación de imágenes, pagos y estados.
4. Cuando se autorice publicación, activar la fila **ya existente** y aumentar el catálogo visible a **63** (62 originales + nueva), verificar ES/PT, filtros, orden de tarjetas, imágenes y disponibilidad en Firebase y GitHub Pages. No duplicar V09-081.
5. Solo permitir compra LIVE tras auditoría de acreditación, beneficiario real confirmado, secretos de producción aislados, controles fail-closed y autorización expresa del pase a LIVE. El usuario ratificó titularidad de `GRECOHERNAN` (ID 84725274), pero **no autorizó activar LIVE ni ejecutar una compra real**.
6. No crear órdenes ni modificar hojas de operaciones para simular regalos; una vez que el pago auténtico esté acreditado, actualizar **solamente la nueva experiencia** a Regalada y cobrada.
7. Mantener `LIVE_MODE=false` y `PAYMENTS_ENABLED=false` hasta autorización separada; sin gastos incrementales ni Railway.

## Referencias
- Seguimiento preparación LIVE: https://github.com/hgreco85/HG-Market-System/issues/2382
- Validación previa TEST: https://github.com/hgreco85/HG-Market-System/issues/2322
- Fuente editorial canónica: Google Sheet «Catálogo circuito v0.9», fila V09-052.
