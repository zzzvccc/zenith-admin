import type { QueryOf } from '@zenith/shared/core';
import { workCalendarContract } from '@zenith/shared/workflow';
import { api, contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type WorkCalendarListParams = QueryOf<typeof workCalendarContract.list>;

const resource = createResourceQueries(workCalendarContract, {
  // 设计器的日历下拉随日历增删改一起变化
  onSaved: (qc) => { void qc.invalidateQueries({ queryKey: workCalendarKeys.options }); },
  onDeleted: (qc) => { void qc.invalidateQueries({ queryKey: workCalendarKeys.options }); },
});

export const workCalendarKeys = {
  ...resource.keys,
  options: contractKey(workCalendarContract.options),
  holidays: contractKey(workCalendarContract.holidays),
};

export const useWorkCalendarList = resource.useList;
export const useSaveWorkCalendar = resource.useSave;
export const useDeleteWorkCalendars = resource.useDelete;

/** 设计器选择 smartSla.calendarId 用的下拉选项 */
export function useWorkCalendarOptions(enabled = true) {
  return useApiQuery(workCalendarContract.options, {}, { enabled });
}

/** 某日历的节假日 / 调休列表 */
export function useCalendarHolidays(calendarId: number | null | undefined, enabled = true) {
  return useApiQuery(workCalendarContract.holidays, { params: { id: calendarId ?? 0 } }, { enabled: enabled && calendarId != null });
}

/** 新增节假日 / 调休 */
export function useCreateCalendarHoliday() {
  return useApiMutation(workCalendarContract.createHoliday);
}

/** 更新节假日 / 调休 */
export function useUpdateCalendarHoliday() {
  return useApiMutation(workCalendarContract.updateHoliday);
}

/** 删除节假日 / 调休 */
export function useDeleteCalendarHoliday() {
  return useApiMutation(workCalendarContract.removeHoliday);
}

/** 命令式拉取（弹窗内用，不入缓存） */
export function fetchCalendarHolidays(calendarId: number) {
  return api(workCalendarContract.holidays, { params: { id: calendarId } }, { silent: true });
}
