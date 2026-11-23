import { useState } from 'react';
import type { Extraction } from '../../shared/domain';
import { Modal } from '../components';

export function ExtractionPreview({ result, existingItems, existingMissing, close, onApply }: {
  result: Extraction; existingItems: number; existingMissing: string[]; close: () => void;
  onApply: (items: Extraction['items'], missingFields: string[]) => void;
}) {
  const [selectedItems, setSelectedItems] = useState(() => result.items.map(() => true));
  const [selectedMissing, setSelectedMissing] = useState(() => result.missingFields.map(() => true));
  const items = result.items.filter((_, index) => selectedItems[index]);
  const missingFields = [...new Set([...existingMissing, ...result.missingFields.filter((_, index) => selectedMissing[index])])];
  const tooManyItems = existingItems + items.length > 100;
  const tooManyMissing = missingFields.length > 30;
  const empty = items.length === 0 && missingFields.length === existingMissing.length;
  return <Modal title="AI 提取结果预览" onClose={close} wide>
    <div className="modal-body">
      <p className="notice">勾选需要采纳的内容。采购需求会追加到现有 {existingItems} 项之后，已确认的商品匹配保持不变；客户资料保持原样。</p>
      <h3>采购需求</h3>
      {result.items.length === 0 && <p className="helper-text">本次未提取到采购需求。</p>}
      <div className="stack">{result.items.map((item, index) => <label className="requirement-card" key={index} style={{ display: 'block', overflowWrap: 'anywhere' }}>
        <div className="inline-actions"><input type="checkbox" aria-label={`采纳需求${index + 1}`} checked={selectedItems[index]} onChange={event => setSelectedItems(selectedItems.map((value, itemIndex) => itemIndex === index ? event.target.checked : value))} /><strong>{item.description}</strong></div>
        <p>型号：{item.model || '待确认'}<br />规格：{item.specification || '待确认'}<br />数量：{item.quantity ?? '待确认'} {item.unit}</p>
      </label>)}</div>
      <h3>待确认信息</h3>
      {result.missingFields.length === 0 && <p className="helper-text">本次没有额外待确认信息。</p>}
      <div className="stack">{result.missingFields.map((field, index) => <label className="inline-actions" key={index} style={{ overflowWrap: 'anywhere' }}>
        <input type="checkbox" aria-label={`采纳待确认项${index + 1}`} checked={selectedMissing[index]} onChange={event => setSelectedMissing(selectedMissing.map((value, fieldIndex) => fieldIndex === index ? event.target.checked : value))} />{field}
      </label>)}</div>
      {tooManyItems && <p className="error-banner" role="alert">追加后超过 100 项采购需求，请减少勾选项。</p>}
      {tooManyMissing && <p className="error-banner" role="alert">合并后超过 30 项待确认信息，请减少勾选项或先解决已有信息。</p>}
      <p className="helper-text">将追加 {items.length} 项需求，新增 {missingFields.length - existingMissing.length} 项待确认信息。采纳后请保存询盘。</p>
    </div>
    <div className="form-actions"><button type="button" className="button secondary" onClick={close}>取消预览</button>
      <button type="button" className="button primary" disabled={empty || tooManyItems || tooManyMissing} onClick={() => onApply(items, missingFields)}>追加到现有需求</button>
    </div>
  </Modal>;
}
