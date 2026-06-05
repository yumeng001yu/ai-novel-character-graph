import { Character, Relation, Event } from '../types';
import { characterRepo } from '../repositories/neo4j/character.repo';
import { relationRepo } from '../repositories/neo4j/relation.repo';
import { eventRepo } from '../repositories/neo4j/event.repo';
import { getLogger } from '../utils/logger';

const logger = getLogger();

export type ExportFormat = 'json' | 'graphml' | 'gexf' | 'csv';

export class ExporterService {
  async export(novelId: string, format: ExportFormat): Promise<string> {
    const characters = await characterRepo.findByNovelId(novelId);
    const relations = await relationRepo.findByNovelId(novelId);
    const events = await eventRepo.findByNovelId(novelId);

    switch (format) {
      case 'json':
        return this.exportJson(characters, relations, events);
      case 'graphml':
        return this.exportGraphML(characters, relations);
      case 'gexf':
        return this.exportGEXF(characters, relations);
      case 'csv':
        return this.exportCSV(characters, relations);
      default:
        throw new Error(`不支持的导出格式: ${format}`);
    }
  }

  private exportJson(characters: Character[], relations: Relation[], events: Event[]): string {
    return JSON.stringify({ characters, relations, events }, null, 2);
  }

  private exportGraphML(characters: Character[], relations: Relation[]): string {
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<graphml xmlns="http://graphml.graphstruct.org/graphml">\n';
    xml += '  <graph id="G" edgedefault="undirected">\n';

    for (const c of characters) {
      xml += `    <node id="${c.id}">\n`;
      xml += `      <data key="name">${this.escapeXml(c.name)}</data>\n`;
      xml += `      <data key="faction">${this.escapeXml(c.faction || '')}</data>\n`;
      xml += `    </node>\n`;
    }

    for (const r of relations) {
      xml += `    <edge source="${r.sourceId}" target="${r.targetId}">\n`;
      xml += `      <data key="relationType">${this.escapeXml(r.relationType)}</data>\n`;
      xml += `      <data key="strength">${r.strength}</data>\n`;
      xml += `    </edge>\n`;
    }

    xml += '  </graph>\n</graphml>';
    return xml;
  }

  private exportGEXF(characters: Character[], relations: Relation[]): string {
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<gexf xmlns="http://www.gexf.net/1.2draft" version="1.2">\n';
    xml += '  <graph mode="static" defaultedgetype="undirected">\n';
    xml += '    <attributes class="node">\n';
    xml += '      <attribute id="0" title="faction" type="string"/>\n';
    xml += '    </attributes>\n';
    xml += '    <nodes>\n';

    for (const c of characters) {
      xml += `      <node id="${c.id}" label="${this.escapeXml(c.name)}">\n`;
      xml += `        <attvalues><attvalue for="0" value="${this.escapeXml(c.faction || '')}"/></attvalues>\n`;
      xml += `      </node>\n`;
    }

    xml += '    </nodes>\n    <edges>\n';

    for (let i = 0; i < relations.length; i++) {
      const r = relations[i];
      xml += `      <edge id="${i}" source="${r.sourceId}" target="${r.targetId}" label="${this.escapeXml(r.relationType)}" weight="${r.strength}"/>\n`;
    }

    xml += '    </edges>\n  </graph>\n</gexf>';
    return xml;
  }

  private exportCSV(characters: Character[], relations: Relation[]): string {
    // 节点表
    let csv = 'id,name,aliases,gender,faction,identity,firstAppearChapter,isProtagonist\n';
    for (const c of characters) {
      csv += `${c.id},"${c.name}","${c.aliases.join(';')}","${c.gender || ''}","${c.faction || ''}","${c.identity || ''}",${c.firstAppearChapter},${c.isProtagonist}\n`;
    }

    csv += '\n\nsourceId,targetId,relationType,sinceChapter,untilChapter,strength,isInference,description\n';
    for (const r of relations) {
      csv += `${r.sourceId},${r.targetId},"${r.relationType}",${r.sinceChapter},${r.untilChapter || ''},${r.strength},${r.isInference},"${(r.description || '').replace(/"/g, '""')}"\n`;
    }

    return csv;
  }

  private escapeXml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}

export const exporterService = new ExporterService();
