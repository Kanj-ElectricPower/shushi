import type { Account, AppData, Category, IncomeSource, QuickButton, Tag } from '../domain/types';

/**
 * 初回起動時の初期データ。誰にでも当てはまる汎用的な項目だけを入れる。
 * 個人の口座・カード・収入源・定期予定はここに書かず、設定画面で登録する。
 */
export function seedData(): Omit<AppData, 'transactions'> {
  const accounts: Account[] = [{ id: 'cash', name: '現金', type: 'cash', openingBalance: 0, order: 0 }];
  const categories: Category[] = ['食費', '交通費', '医療', 'サブスク', '宿泊', 'その他'].map((name, i) => ({
    id: `cat-${i}`,
    name,
    order: i,
  }));
  const tags: Tag[] = ['通常', '交際'].map((name, i) => ({ id: `tag-${i}`, name, order: i }));
  const incomeSources: IncomeSource[] = (
    [
      ['src-salary', '給与', 'salary', false],
      ['src-misc', '副業(雑所得)', 'misc', false],
      ['src-family', '家族からの支給', 'family', false],
      ['src-refund', '還付金', 'other', false],
      // 立替の精算入金に使う。収支と所得集計から除外される
      ['src-reimbursement', '立替精算', 'reimbursement', false],
    ] as const
  ).map(([id, name, incomeType, hasWithholding], order) => ({ id, name, incomeType, hasWithholding, order }));
  const quickButtons: QuickButton[] = [
    { id: 'quick-food', label: '食費', template: { kind: 'expense', categoryId: 'cat-0', tagId: 'tag-0' }, order: 0 },
    { id: 'quick-transit', label: '交通費', template: { kind: 'expense', categoryId: 'cat-1', tagId: 'tag-0' }, order: 1 },
  ];
  // 年収の壁は税制改正で金額が変わるため、初期値は入れず設定画面で登録してもらう
  return { accounts, categories, tags, incomeSources, recurrings: [], quickButtons, incomeWalls: [] };
}
