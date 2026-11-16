import Icon, { type IconName } from './icons';

type Props = {
  icon: IconName;
  title: string;
  description: string;
  action?: React.ReactNode;
};

export default function EmptyState({ icon, title, description, action }: Props) {
  return (
    <div className="card coming-soon">
      <div className="coming-soon__icon"><Icon name={icon} /></div>
      <div className="coming-soon__title">{title}</div>
      <div className="coming-soon__desc">{description}</div>
      {action && <div style={{ marginTop: 12 }}>{action}</div>}
    </div>
  );
}
