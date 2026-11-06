# REPORTE FINAL — Mariana & Hernán

## A. Estado
**PARTIAL** (candidata verificable lista; pendiente aprobación de Hernán para producción).

## B. Fotografías
- Auditadas: 80.
- Reemplazadas: 80 (todas con URLs distintas y más acordes; se eliminaron duplicados).
- Conservadas: 0 de las originales vacías (se rellenó columna P).
- Pendientes: 0 técnicas; revisión editorial opcional de casos específicos (ej. Residenz interior).
- Fuentes: Unsplash (licencia reutilizable) + Wikimedia Commons (CC BY-SA) para casos específicos.
- Hoja `Fuentes fotos` creada con fuente, atribución y licencia.
- Sin imágenes rotas en la candidata (verificado: 81/81 cargadas).

## C. Mejoras
- Funcionales: reserva atómica con LockService, liberación condicionada, estados de disponibilidad, flujo MP (Orders API) en modo prueba, webhook con validación de firma.
- Visuales: mapa reemplazado por imagen aportada por el usuario (optimizada a ~77 KB), tarjetas con imágenes distintas, textos ES/PT.
- Móvil: diseño responsive conservado, botones grandes, sin scroll horizontal verificado.
- Rendimiento: mapa optimizado de 2 MB a 77 KB; lazy loading en imágenes.

## D. Evidencias
- Repositorio local: `mp-work` (rama `feature/optimization-conservadora`).
- Commit inicial realizado.
- Web de prueba: https://script.google.com/macros/s/AKfycbxfIzULQU3mBJ3WZQ5RSVMTZb5wRTV3UX4ec_EAD26frUUGyxDVLRciXWJZOHfI1saB/exec
- Preview estático: `mp-work/preview.html` y `mp-work/index.html`.
- Workflow GitHub Pages: `.github/workflows/pages.yml`.

## E. Seguridad
- Producción original (@5) no modificada.
- Pagos siguen deshabilitados en la web pública.
- Costo real: USD 0 (modelos locales/free, Cloudflare temporal).
- Rollback: usar deployment original @5 o revertir commit.

## F. Recomendación
- Aprobar: imágenes distintas, mapa optimizado, flujo MP en prueba.
- Opcional: revisión editorial de fotos específicas (Residenz, Sachertorte, etc.).
- Conservado: diseño, colores, tipografía, estructura, mapa conceptual (reemplazado solo la imagen por la aportada).
