import { redirect } from 'next/navigation';

export default function LabsIndex() {
  redirect('/labs/summary?cat=blood');
}
