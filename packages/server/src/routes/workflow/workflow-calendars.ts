import { OpenAPIHono } from '@hono/zod-openapi';
import { workCalendarContract } from '@zenith/shared/workflow';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  workflowCalendarService,
  listWorkflowCalendarOptions,
  listCalendarHolidays,
  createCalendarHoliday,
  updateCalendarHoliday,
  deleteCalendarHoliday,
} from '../../services/workflow/workflow-calendars.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const optionsRoute = defineContractRoute(workCalendarContract.options, {
  handler: async (c) => c.json(okBody(await listWorkflowCalendarOptions()), 200),
});

const holidaysRoute = defineContractRoute(workCalendarContract.holidays, {
  handler: async (c) => c.json(okBody(await listCalendarHolidays(c.req.valid('param').id)), 200),
});

const createHolidayRoute = defineContractRoute(workCalendarContract.createHoliday, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await createCalendarHoliday(id, c.req.valid('json')), '已新增'), 200);
  },
});

const updateHolidayRoute = defineContractRoute(workCalendarContract.updateHoliday, {
  handler: async (c) => {
    const { id, holidayId } = c.req.valid('param');
    return c.json(okBody(await updateCalendarHoliday(id, holidayId, c.req.valid('json')), '已更新'), 200);
  },
});

const removeHolidayRoute = defineContractRoute(workCalendarContract.removeHoliday, {
  handler: async (c) => {
    const { id, holidayId } = c.req.valid('param');
    await deleteCalendarHoliday(id, holidayId);
    return c.json(okBody(null, '已删除'), 200);
  },
});

mountCrud(router, workCalendarContract,
  workflowCalendarService,
  { messages: { create: '已创建', update: '已更新', remove: '已删除' } },
  [optionsRoute, holidaysRoute, createHolidayRoute, updateHolidayRoute, removeHolidayRoute],
);

export default router;
