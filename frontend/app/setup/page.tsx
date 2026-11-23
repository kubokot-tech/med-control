import SetupForm from '../ui/SetupForm';
import { SetupChrome } from '../ui/AuthChrome';

export default function SetupPage() {
  return (
    <div className="login-page">
      <div className="login-card">
        <SetupChrome />
        <SetupForm />
      </div>
    </div>
  );
}
