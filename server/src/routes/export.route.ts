import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { exporterService, ExportFormat } from '../services/exporter.service';

export async function exportRoutes(app: FastifyInstance) {
  app.get('/:id/export', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as any;
    const { format } = req.query as any;

    const validFormats: ExportFormat[] = ['json', 'graphml', 'gexf', 'csv'];
    const exportFormat: ExportFormat = validFormats.includes(format) ? format : 'json';

    try {
      const data = await exporterService.export(id, exportFormat);

      const contentTypes: Record<string, string> = {
        json: 'application/json',
        graphml: 'application/xml',
        gexf: 'application/xml',
        csv: 'text/csv',
      };

      reply.header('Content-Type', contentTypes[exportFormat]);
      reply.header('Content-Disposition', `attachment; filename="graph.${exportFormat}"`);
      reply.send(data);
    } catch (err: any) {
      reply.status(400).send({ error: err.message });
    }
  });
}
