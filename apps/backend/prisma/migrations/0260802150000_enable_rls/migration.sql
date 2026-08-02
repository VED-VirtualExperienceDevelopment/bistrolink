-- Migración: Aislamiento multi-tenant vía Row Level Security (EDT 1.2.7 / RD.07)
--
-- Estrategia (Opción B): un único Realm de Keycloak; el JWT trae el claim
-- "tenant_id" (UUID), que el backend copia a la variable de sesión de Postgres
-- "app.tenant_id" antes de cada consulta (ver src/prisma/tenant-prisma.service.ts).
-- Las políticas de abajo filtran cada fila por esa variable de sesión.
--
-- IMPORTANTE: toda migración que toque estas tablas requiere revisión
-- obligatoria de un segundo integrante del equipo (regla R-14, Anexo 6 §9).

DO $$
DECLARE
  tabla TEXT;
  tablas_multitenant TEXT[] := ARRAY[
    'restaurante',
    'usuario',
    'mesa',
    'categoria_carta',
    'item_carta',
    'pedido',
    'linea_pedido',
    'pago',
    'comprobante_fiscal',
    'pedido_estado_historial'
  ];
BEGIN
  FOREACH tabla IN ARRAY tablas_multitenant LOOP

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tabla);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', tabla);

    EXECUTE format(
      'CREATE POLICY tenant_isolation_select ON %I
         FOR SELECT
         USING (tenant_id = current_setting(''app.tenant_id'')::uuid);',
      tabla
    );

    EXECUTE format(
      'CREATE POLICY tenant_isolation_insert ON %I
         FOR INSERT
         WITH CHECK (tenant_id = current_setting(''app.tenant_id'')::uuid);',
      tabla
    );

    EXECUTE format(
      'CREATE POLICY tenant_isolation_update ON %I
         FOR UPDATE
         USING (tenant_id = current_setting(''app.tenant_id'')::uuid)
         WITH CHECK (tenant_id = current_setting(''app.tenant_id'')::uuid);',
      tabla
    );

    EXECUTE format(
      'CREATE POLICY tenant_isolation_delete ON %I
         FOR DELETE
         USING (tenant_id = current_setting(''app.tenant_id'')::uuid);',
      tabla
    );

  END LOOP;
END $$;