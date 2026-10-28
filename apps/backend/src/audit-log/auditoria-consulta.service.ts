import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { ConsultarAuditoriaDto } from './dto/consultar-auditoria.dto';

export const TAMANO_PAGINA_AUDITORIA = 50;

export interface RegistroAuditoriaVista {
  id: string;
  fecha: string;
  accion: string;
  entidad: string;
  entidadId: string | null;
  /** Quién: nombre o usuario del tenant, o null (plataforma, script). */
  usuario: { id: string; nombre: string } | null;
  actorKeycloakId: string;
  valoresAntes: Prisma.JsonValue;
  valoresDespues: Prisma.JsonValue;
  detalle: Prisma.JsonValue;
  ip: string | null;
}

export interface PaginaAuditoria {
  registros: RegistroAuditoriaVista[];
  pagina: number;
  hayMas: boolean;
}

function nombreVisible(u: {
  nombre: string | null;
  apellido: string | null;
  username: string | null;
  email: string | null;
}): string {
  const completo = [u.nombre, u.apellido].filter(Boolean).join(' ');
  return completo || u.username || u.email || 'Usuario sin nombre';
}

/**
 * HU-035 (BL-205): consulta del registro de auditoría para el
 * administrador. Siempre dentro del tenant del token (RLS): un
 * administrador nunca ve registros de otro establecimiento.
 */
@Injectable()
export class AuditoriaConsultaService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async consultar(
    tenantId: string,
    filtros: ConsultarAuditoriaDto,
  ): Promise<PaginaAuditoria> {
    const desde = filtros.desde ? new Date(filtros.desde) : undefined;
    const hasta = filtros.hasta ? new Date(filtros.hasta) : undefined;
    if (desde && hasta && desde > hasta) {
      throw new BadRequestException(
        'La fecha «desde» tiene que ser anterior a «hasta»',
      );
    }
    const pagina = filtros.pagina ?? 1;

    const where: Prisma.RegistroAuditoriaWhereInput = {
      ...(desde || hasta
        ? {
            createdAt: {
              ...(desde ? { gte: desde } : {}),
              ...(hasta ? { lte: hasta } : {}),
            },
          }
        : {}),
      ...(filtros.usuarioId ? { usuarioId: filtros.usuarioId } : {}),
      ...(filtros.accion ? { accion: filtros.accion } : {}),
    };

    return this.tenantPrisma.runInTenantContext(tenantId, async (tx) => {
      // Uno de más, para saber si hay otra página sin contar todo.
      const filas = await tx.registroAuditoria.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (pagina - 1) * TAMANO_PAGINA_AUDITORIA,
        take: TAMANO_PAGINA_AUDITORIA + 1,
      });
      const hayMas = filas.length > TAMANO_PAGINA_AUDITORIA;
      const visibles = filas.slice(0, TAMANO_PAGINA_AUDITORIA);

      const ids = [
        ...new Set(visibles.map((f) => f.usuarioId).filter(Boolean)),
      ] as string[];
      const usuarios = ids.length
        ? await tx.usuario.findMany({
            where: { id: { in: ids } },
            select: {
              id: true,
              nombre: true,
              apellido: true,
              username: true,
              email: true,
            },
          })
        : [];
      const porId = new Map(usuarios.map((u) => [u.id, u]));

      return {
        pagina,
        hayMas,
        registros: visibles.map((f) => {
          const u = f.usuarioId ? porId.get(f.usuarioId) : undefined;
          return {
            id: f.id,
            fecha: f.createdAt.toISOString(),
            accion: f.accion,
            entidad: f.entidad,
            entidadId: f.entidadId,
            usuario: u ? { id: u.id, nombre: nombreVisible(u) } : null,
            actorKeycloakId: f.actorKeycloakId,
            valoresAntes: f.valoresAntes,
            valoresDespues: f.valoresDespues,
            detalle: f.detalle,
            ip: f.ip,
          };
        }),
      };
    });
  }
}
