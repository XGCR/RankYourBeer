import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopApi } from '../shared/model.ts'

const api: DesktopApi = {
  view: query => ipcRenderer.invoke('view', query),
  entry: id => ipcRenderer.invoke('entry', id),
  save: draft => ipcRenderer.invoke('save', draft),
  remove: id => ipcRenderer.invoke('remove', id),
  pickPhoto: () => ipcRenderer.invoke('pick-photo'),
  presets: () => ipcRenderer.invoke('presets'),
  savePreset: preset => ipcRenderer.invoke('save-preset', preset),
  removePreset: name => ipcRenderer.invoke('remove-preset', name),
  exportCsv: query => ipcRenderer.invoke('export-csv', query),
  backup: () => ipcRenderer.invoke('backup'),
  restore: () => ipcRenderer.invoke('restore'),
  updateCatalog: () => ipcRenderer.invoke('update-catalog'),
  openSource: url => ipcRenderer.invoke('open-source', url),
}

contextBridge.exposeInMainWorld('beerRanking', api)
