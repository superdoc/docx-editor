export function CollaborationOverview() {
  return (
    <figure className='sd-collaboration-overview' aria-label='An edit shared between two editors'>
      <div className='sd-collaboration-overview-flow'>
        <div className='sd-collaboration-overview-editor'>
          <strong>Alex's editor</strong>
          <span>Changes the date</span>
          <p>
            Delivery is due <mark>Friday</mark>.
          </p>
        </div>
        <span className='sd-collaboration-overview-arrow' aria-hidden='true'>
          ↔
        </span>
        <div className='sd-collaboration-overview-room'>
          <strong>Shared room</strong>
          <span>Delivery agreement</span>
        </div>
        <span className='sd-collaboration-overview-arrow' aria-hidden='true'>
          ↔
        </span>
        <div className='sd-collaboration-overview-editor'>
          <strong>Sam's editor</strong>
          <span>Receives the change</span>
          <p>
            Delivery is due <mark>Friday</mark>.
          </p>
        </div>
      </div>
      <figcaption>Illustration · Two editors, one shared document.</figcaption>
    </figure>
  );
}
