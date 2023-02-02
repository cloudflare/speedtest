import 'isomorphic-fetch';

export default class ReachabilityEngine {
  constructor(targetUrl, { timeout = -1, fetchOptions = {} } = {}) {
    let finished = false;
    const finish = ({ reachable, ...rest }) => {
      if (finished) return;
      finished = true;
      this.onFinished({
        targetUrl,
        reachable,
        ...rest
      });
    };

    fetch(targetUrl, fetchOptions)
      .then(response => {
        finish({
          reachable: true,
          response
        });
      })
      .catch(error => {
        finish({
          reachable: false,
          error
        });
      });

    timeout > 0 &&
      setTimeout(
        () => finish({ reachable: false, error: 'Request timeout' }),
        timeout
      );
  }

  // Public attributes
  onFinished = () => {};
}
