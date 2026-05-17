import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { cwFetch, handleToolCall } from '../client.js';
import { CwRequestContext } from '../types.js';
import { addTool, Schema, buildPaginationSchema, idSchema } from './helper.js';

const pag: Schema = buildPaginationSchema();

const listSchema: Schema = { ...pag };
const byProductId: Schema = {
  id: idSchema('Product ID'),
  fields: z.string().optional().describe('Fields to return'),
};
const byCatalogId: Schema = {
  id: idSchema('Catalog item ID'),
  fields: z.string().optional().describe('Fields to return'),
};
const byPurchaseOrderId: Schema = {
  id: idSchema('Purchase order ID'),
  fields: z.string().optional().describe('Fields to return'),
};
const byRmaActionId: Schema = {
  id: idSchema('RMA action ID'),
  fields: z.string().optional().describe('Fields to return'),
};

export function register(server: McpServer, ctx: CwRequestContext): void {
  addTool(
    server,
    'get_products',
    'List sold/quoted products (instances of catalog items associated with companies, agreements, opportunities). Pass `conditions` to filter, `fields` to project.',
    listSchema,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, '/procurement/products', args)),
  );

  addTool(
    server,
    'get_product_by_id',
    'Retrieve a single product by its ID.',
    byProductId,
    (args) =>
      handleToolCall(ctx, (c) =>
        cwFetch(c, `/procurement/products/${args.id}`, { fields: args.fields }),
      ),
  );

  addTool(
    server,
    'get_catalog_items',
    'List catalog items (product definitions / SKUs). Pass `conditions` to filter, `fields` to project.',
    listSchema,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, '/procurement/catalog', args)),
  );

  addTool(
    server,
    'get_catalog_item_by_id',
    'Retrieve a single catalog item by its ID.',
    byCatalogId,
    (args) =>
      handleToolCall(ctx, (c) =>
        cwFetch(c, `/procurement/catalog/${args.id}`, { fields: args.fields }),
      ),
  );

  addTool(
    server,
    'get_purchase_orders',
    'List purchase orders. Pass `conditions` to filter (status, vendor, date range).',
    listSchema,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, '/procurement/purchaseorders', args)),
  );

  addTool(
    server,
    'get_purchase_order_by_id',
    'Retrieve a single purchase order by its ID.',
    byPurchaseOrderId,
    (args) =>
      handleToolCall(ctx, (c) =>
        cwFetch(c, `/procurement/purchaseorders/${args.id}`, { fields: args.fields }),
      ),
  );

  addTool(
    server,
    'get_rma_actions',
    'List Return Material Authorization (RMA) actions.',
    listSchema,
    (args) => handleToolCall(ctx, (c) => cwFetch(c, '/procurement/rmaActions', args)),
  );

  addTool(
    server,
    'get_rma_action_by_id',
    'Retrieve a single RMA action by its ID.',
    byRmaActionId,
    (args) =>
      handleToolCall(ctx, (c) =>
        cwFetch(c, `/procurement/rmaActions/${args.id}`, { fields: args.fields }),
      ),
  );
}
