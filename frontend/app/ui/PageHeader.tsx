type Props = {
  title: string;
  description?: string;
  children?: React.ReactNode;
};

export default function PageHeader({ title, description, children }: Props) {
  return (
    <div className="page-header">
      <h1 className="page-header__title">{title}</h1>
      {description && <p className="page-header__desc">{description}</p>}
      {children && <div className="page-header__actions">{children}</div>}
    </div>
  );
}
