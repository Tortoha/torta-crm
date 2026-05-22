import { useParams } from 'react-router-dom';
import DocContent from '../../Elements/DocContent.jsx';

export default function DocsPage() {
  const { section } = useParams();
  return <DocContent section={section} />;
}
