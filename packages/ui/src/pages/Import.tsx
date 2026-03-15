import { useNavigate } from 'react-router-dom';

export function Import() {
  const navigate = useNavigate();

  const handleContinue = () => {
    navigate('/workspace');
  };

  return (
    <div style={{ padding: '2rem' }}>
      <h1>Data Import</h1>
      <p>Drag and drop CSV files here or use the file picker.</p>
      <p>Supported formats: Interactive Brokers activity statement, Revolut savings CSV</p>
      <button onClick={handleContinue}>Continue to Workspace</button>
    </div>
  );
}
