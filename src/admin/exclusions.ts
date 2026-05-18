import type { RequestHandler } from 'express';
import { getSql } from '../db.js';
import { invalidateExclusionsCache } from '../composites/company-exclusions.js';
import { cwFetch } from '../client.js';
import { getCwConnection } from '../config.js';
import { escapeConditionLiteral } from '../tools/helper.js';

interface ExclusionRow {
  cw_company_id: string;
  cw_company_identifier: string | null;
  cw_company_name: string | null;
  reason: string;
  added_by: string;
  added_at: Date;
}

interface CompanySearchResult {
  id: number;
  name: string;
  identifier: string;
  status: string | null;
}

export const exclusionsGetHandler: RequestHandler = async (req, res, next) => {
  try {
    const sql = getSql();
    const rows = await sql<ExclusionRow[]>`
      SELECT
        cw_company_id::text AS cw_company_id,
        cw_company_identifier,
        cw_company_name,
        reason,
        added_by,
        added_at
      FROM excluded_companies
      ORDER BY added_at DESC
    `;
    res.render('exclusions', {
      title: 'Excluded companies',
      admin: req.admin,
      exclusions: rows,
      flash: typeof req.query.flash === 'string' ? req.query.flash : null,
    });
  } catch (err) {
    next(err);
  }
};

const SEARCH_PAGE_SIZE = 50;
const MIN_QUERY_LENGTH = 2;

export const exclusionsSearchHandler: RequestHandler = async (req, res, next) => {
  try {
    const raw = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (raw.length < MIN_QUERY_LENGTH) {
      res.type('html').send(
        '<p class="muted" style="padding: 8px; margin: 0;">Keep typing — at least 2 characters.</p>',
      );
      return;
    }
    const conn = await getCwConnection();
    if (!conn || !conn.companyId || !conn.publicKey || !conn.privateKey) {
      res.type('html').send(
        '<p class="muted" style="padding: 8px; margin: 0;">CW connection not configured.</p>',
      );
      return;
    }
    const safe = escapeConditionLiteral(raw);
    const result = await cwFetch<
      Array<{ id?: number; name?: string; identifier?: string; status?: { name?: string } }>
    >(conn, '/company/companies', {
      conditions: `name contains '${safe}' OR identifier = '${safe}'`,
      fields: 'id,name,identifier,status',
      pageSize: SEARCH_PAGE_SIZE,
      orderBy: 'name asc',
    });
    const rows: CompanySearchResult[] = Array.isArray(result.data)
      ? result.data
          .filter((c) => typeof c?.id === 'number' && typeof c?.name === 'string')
          .map((c) => ({
            id: c.id!,
            name: c.name!,
            identifier: c.identifier ?? '',
            status: c.status?.name ?? null,
          }))
      : [];
    res.render('_company-search-results', { rows, layout: false });
  } catch (err) {
    next(err);
  }
};

export const exclusionAddHandler: RequestHandler = async (req, res, next) => {
  try {
    const body = req.body as {
      cw_company_id?: string;
      cw_company_identifier?: string;
      cw_company_name?: string;
      reason?: string;
    };
    const idNum = Number(body.cw_company_id?.trim());
    const reason = body.reason?.trim();
    if (!Number.isInteger(idNum) || idNum <= 0 || !reason) {
      res.redirect(302, '/admin/exclusions?flash=missing');
      return;
    }
    const sql = getSql();
    await sql`
      INSERT INTO excluded_companies (cw_company_id, cw_company_identifier, cw_company_name, reason, added_by)
      VALUES (
        ${idNum},
        ${body.cw_company_identifier?.trim() || null},
        ${body.cw_company_name?.trim() || null},
        ${reason},
        ${req.admin?.email ?? 'admin'}
      )
      ON CONFLICT (cw_company_id) DO UPDATE SET
        cw_company_identifier = EXCLUDED.cw_company_identifier,
        cw_company_name = EXCLUDED.cw_company_name,
        reason = EXCLUDED.reason,
        added_by = EXCLUDED.added_by,
        added_at = now()
    `;
    invalidateExclusionsCache();
    res.redirect(302, '/admin/exclusions?flash=added');
  } catch (err) {
    next(err);
  }
};

export const exclusionDeleteHandler: RequestHandler = async (req, res, next) => {
  try {
    const idNum = Number(req.params.id);
    if (!Number.isInteger(idNum) || idNum <= 0) {
      res.status(400).send('Bad company ID');
      return;
    }
    const sql = getSql();
    await sql`DELETE FROM excluded_companies WHERE cw_company_id = ${idNum}`;
    invalidateExclusionsCache();
    res.redirect(302, '/admin/exclusions?flash=removed');
  } catch (err) {
    next(err);
  }
};
